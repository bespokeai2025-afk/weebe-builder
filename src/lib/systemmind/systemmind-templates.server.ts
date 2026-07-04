/**
 * SystemMind Template Library & Parameters — SERVER ONLY (spec Phases 3, 4, 7).
 * Loaded dynamically inside createServerFn handlers.
 *
 * Turns the discovered, AI-understood n8n workflows (table
 * `systemmind_n8n_workflows`, produced by the discovery task) into a curated,
 * reusable Workflow Template Library:
 *   1. Classification (template type + business category), with admin override.
 *   2. Parameter extraction — customer-specific values → named deployment vars.
 *   3. Curated template repository + version history.
 *   4. Draft → approved lifecycle (only approved templates are trusted).
 *
 * Strictly ADDITIVE. Read-only against the discovery tables — never re-scans n8n,
 * never deploys anything. SECURITY: raw node parameters can contain tenant
 * secrets, so structure snapshots store node identity only (no parameters) and
 * detected values are stored as MASKED examples — raw secret values are never
 * persisted onto a template.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Types ────────────────────────────────────────────────────────────────────

export type TemplateType =
  | "reusable_template"
  | "customer_specific"
  | "experimental"
  | "legacy"
  | "archive";

export const TEMPLATE_TYPES: TemplateType[] = [
  "reusable_template",
  "customer_specific",
  "experimental",
  "legacy",
  "archive",
];

export const WORKFLOW_CATEGORIES = [
  "Receptionist",
  "Lead Generation",
  "Client Qualification",
  "Appointment Booking",
  "CRM Synchronisation",
  "Transcript Processing",
  "Follow-Up Campaign",
  "WhatsApp Automation",
  "Notification",
  "Call Transfer",
  "Knowledge Base",
  "Reporting",
  "Data Sync",
  "General",
] as const;

export type ParamCategory =
  | "tenant"
  | "branding"
  | "secret"
  | "credential"
  | "agent"
  | "phone"
  | "email"
  | "webhook"
  | "endpoint"
  | "provider"
  | "voice"
  | "prompt";

export interface DeploymentVariable {
  key: string;
  name: string;
  type: "string" | "number" | "boolean" | "secret" | "url";
  category: ParamCategory;
  description: string;
  example: string; // MASKED — never a raw secret value
  required: boolean;
  source: string; // where in the workflow it was detected
}

export interface WorkflowClassification {
  type: TemplateType;
  category: string;
  reasoning: string;
  signals: string[];
  confidence: number;
  auto: boolean;
  snapshot_updated_at: string | null;
}

// ── Masking helpers (never persist raw secrets) ───────────────────────────────

function maskSecret(v: string): string {
  const s = String(v);
  if (s.length <= 4) return "••••";
  return `${s.slice(0, 3)}…${s.slice(-4)}`;
}

function maskExample(value: string, category: ParamCategory): string {
  const v = String(value).trim();
  if (!v) return "";
  if (category === "secret" || category === "credential") return maskSecret(v);
  if (category === "phone") {
    const digits = v.replace(/[^\d+]/g, "");
    if (digits.length <= 4) return "••••";
    return `${digits.slice(0, 2)}••••${digits.slice(-2)}`;
  }
  if (category === "email") {
    const at = v.indexOf("@");
    if (at <= 0) return "•••@•••";
    return `${v[0]}•••${v.slice(at)}`;
  }
  if (category === "webhook" || category === "endpoint") {
    try {
      const u = new URL(v);
      return `${u.protocol}//${u.host}/…`;
    } catch {
      return v.length > 40 ? `${v.slice(0, 40)}…` : v;
    }
  }
  return v.length > 48 ? `${v.slice(0, 48)}…` : v;
}

function slugify(s: string, fallback: string): string {
  const out = String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return out || fallback;
}

// ── Value pattern detectors ───────────────────────────────────────────────────

const RE_URL = /^https?:\/\/[^\s]+$/i;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_PHONE = /^\+?\d[\d\s().-]{6,}\d$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_APIKEY = /^(sk-|pk-|key-|bearer\s|xox|ghp_|AIza|re_)[A-Za-z0-9._\-]{8,}$/;
const RE_LONGSECRET = /^[A-Za-z0-9._\-]{28,}$/; // long opaque token

function isExpression(v: string): boolean {
  return v.includes("{{") || v.trimStart().startsWith("=");
}

function keyHint(key: string): ParamCategory | null {
  const k = key.toLowerCase();
  if (/(apikey|api_key|token|secret|authorization|bearer|password|access_key)/.test(k)) return "secret";
  if (/(phone|mobile|tel\b|number)/.test(k)) return "phone";
  if (/(email|e-mail|mailto)/.test(k)) return "email";
  if (/(company|business|brand|organi[sz]ation|org_name)/.test(k)) return "branding";
  if (/(voice)/.test(k)) return "voice";
  if (/(agent).*(id)|agent_id/.test(k)) return "agent";
  if (/(webhook)/.test(k)) return "webhook";
  if (/(url|endpoint|uri|host)/.test(k)) return "endpoint";
  if (/(prompt|system_message|instruction)/.test(k)) return "prompt";
  if (/(workspace|tenant|account_id|customer_id)/.test(k)) return "tenant";
  return null;
}

function valueCategory(v: string): ParamCategory | null {
  if (RE_APIKEY.test(v)) return "secret";
  if (RE_EMAIL.test(v)) return "email";
  if (RE_URL.test(v)) return "endpoint";
  if (RE_PHONE.test(v.trim())) return "phone";
  if (RE_UUID.test(v)) return "tenant";
  if (RE_LONGSECRET.test(v) && /[0-9]/.test(v) && /[a-z]/i.test(v)) return "secret";
  return null;
}

// Recursively collect string leaves from a node's parameters.
function collectLeaves(
  value: any,
  onLeaf: (key: string, val: string) => void,
  key = "",
  depth = 0,
): void {
  if (depth > 8) return;
  if (typeof value === "string") {
    onLeaf(key, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectLeaves(v, onLeaf, key, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) collectLeaves(v, onLeaf, k, depth + 1);
  }
}

// ── Parameter extraction ──────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<ParamCategory, string> = {
  tenant: "Tenant / account identifier",
  branding: "Company / branding value",
  secret: "Secret / API key",
  credential: "Credential",
  agent: "Voice agent identifier",
  phone: "Phone number",
  email: "Email address",
  webhook: "Webhook path",
  endpoint: "External endpoint / URL",
  provider: "Provider selection",
  voice: "Voice selection",
  prompt: "Prompt / instruction template",
};

const CATEGORY_TYPE: Record<ParamCategory, DeploymentVariable["type"]> = {
  tenant: "string",
  branding: "string",
  secret: "secret",
  credential: "secret",
  agent: "string",
  phone: "string",
  email: "string",
  webhook: "url",
  endpoint: "url",
  provider: "string",
  voice: "string",
  prompt: "string",
};

/**
 * Detect customer-specific values in a discovered workflow and return them as
 * named deployment variables. Deterministic scan of metadata + raw node
 * parameters, enriched with the AI understanding's tenant-specific hints.
 * Secret-category values are stored masked — never raw.
 */
export function extractParameters(row: any): DeploymentVariable[] {
  const meta = row?.metadata ?? {};
  const raw = row?.raw_snapshot ?? {};
  const understanding = row?.understanding ?? {};

  const vars: DeploymentVariable[] = [];
  const seen = new Set<string>();

  const push = (v: DeploymentVariable) => {
    const dedupe = `${v.category}::${v.key}::${v.example}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    if (vars.length < 60) vars.push(v);
  };

  // 1. Credentials (labels/types only — never secrets).
  for (const c of (meta.credentials ?? []) as Array<{ type: string; name: string }>) {
    push({
      key: slugify(`cred_${c.type}`, "credential"),
      name: `${c.name} credential`,
      type: "secret",
      category: "credential",
      description: `Requires a "${c.type}" credential to be configured per tenant.`,
      example: "",
      required: true,
      source: `credential: ${c.type}`,
    });
  }

  // 2. Webhooks — the receiving path is instance-specific.
  for (const w of (meta.webhooks ?? []) as Array<{ node: string; method: string; path: string }>) {
    if (!w.path) continue;
    push({
      key: slugify(`webhook_${w.path}`, "webhook_path"),
      name: `Webhook path (${w.node})`,
      type: "url",
      category: "webhook",
      description: `Inbound ${w.method} webhook path — unique per deployment.`,
      example: maskExample(w.path, "webhook"),
      required: true,
      source: `webhook node: ${w.node}`,
    });
  }

  // 3. Outbound HTTP endpoints — often tenant-specific hosts.
  for (const h of (meta.httpRequests ?? []) as Array<{ node: string; method: string; url: string }>) {
    if (!h.url || isExpression(h.url)) continue;
    push({
      key: slugify(`endpoint_${h.node}`, "endpoint"),
      name: `Endpoint (${h.node})`,
      type: "url",
      category: "endpoint",
      description: `${h.method} request target — verify per tenant.`,
      example: maskExample(h.url, "endpoint"),
      required: false,
      source: `http node: ${h.node}`,
    });
  }

  // 4. Literal values embedded in node parameters (redacted).
  const nodes: any[] = Array.isArray(raw?.nodes) ? raw.nodes : [];
  for (const node of nodes) {
    const nodeName = String(node?.name ?? node?.id ?? "node");
    collectLeaves(node?.parameters ?? {}, (k, val) => {
      const s = String(val).trim();
      if (!s || s.length < 4 || isExpression(s)) return;
      const cat = keyHint(k) ?? valueCategory(s);
      if (!cat) return;
      // Skip obvious boilerplate / http verbs.
      if (/^(get|post|put|patch|delete|true|false|null|application\/json)$/i.test(s)) return;
      push({
        key: slugify(`${cat}_${k || nodeName}`, cat),
        name: `${CATEGORY_LABEL[cat]} (${nodeName})`,
        type: CATEGORY_TYPE[cat],
        category: cat,
        description: `Detected in "${nodeName}" — ${CATEGORY_LABEL[cat].toLowerCase()} that changes per tenant.`,
        example: maskExample(s, cat),
        required: cat === "secret" || cat === "credential",
        source: `node "${nodeName}" · field "${k}"`,
      });
    });
  }

  // 5. AI understanding hints (descriptive, no literal values).
  for (const hint of (understanding.tenant_specific_values ?? []) as string[]) {
    const h = String(hint).trim();
    if (!h) continue;
    push({
      key: slugify(`hint_${h}`, "tenant_value"),
      name: h.length > 60 ? `${h.slice(0, 60)}…` : h,
      type: "string",
      category: "tenant",
      description: "Flagged by AI understanding as tenant-specific.",
      example: "",
      required: false,
      source: "AI understanding",
    });
  }

  return vars;
}

// ── Provider categorisation ───────────────────────────────────────────────────

const PROVIDER_MAP: Record<string, keyof ProviderBuckets> = {};
function reg(bucket: keyof ProviderBuckets, ...names: string[]) {
  for (const n of names) PROVIDER_MAP[n.toLowerCase()] = bucket;
}
type ProviderBuckets = {
  agent: string[];
  crm: string[];
  calendar: string[];
  telephony: string[];
  messaging: string[];
};
reg("agent", "retell", "vapi", "elevenlabs", "eleven labs", "openai", "anthropic", "bland");
reg("crm", "hubspot", "salesforce", "pipedrive", "zoho", "gohighlevel", "go high level", "airtable", "notion", "close", "copper");
reg("calendar", "cal", "calcom", "cal.com", "calendly", "google calendar", "googlecalendar", "outlook calendar", "acuity");
reg("telephony", "twilio", "vonage", "telnyx", "plivo", "sip", "aircall", "retell");
reg("messaging", "whatsapp", "wati", "slack", "telegram", "discord", "messagebird", "gupshup");

function categorizeProviders(services: string[]): ProviderBuckets {
  const b: ProviderBuckets = { agent: [], crm: [], calendar: [], telephony: [], messaging: [] };
  for (const raw of services) {
    const s = String(raw).toLowerCase();
    for (const [key, bucket] of Object.entries(PROVIDER_MAP)) {
      if (s.includes(key)) {
        if (!b[bucket].includes(raw)) b[bucket].push(raw);
      }
    }
  }
  return b;
}

// ── Classification ────────────────────────────────────────────────────────────

function includesAny(hay: string, needles: string[]): boolean {
  const h = hay.toLowerCase();
  return needles.some((n) => h.includes(n));
}

const CATEGORY_KEYWORDS: Array<{ category: string; kw: string[] }> = [
  { category: "Receptionist", kw: ["reception", "front desk", "greet", "route call", "answering"] },
  { category: "Lead Generation", kw: ["lead gen", "lead capture", "prospect", "outreach", "cold"] },
  { category: "Client Qualification", kw: ["qualif", "screening", "bant", "score lead", "intake"] },
  { category: "Appointment Booking", kw: ["appointment", "booking", "schedule", "calendar", "reschedul"] },
  { category: "CRM Synchronisation", kw: ["crm", "hubspot", "salesforce", "pipedrive", "sync contact", "upsert"] },
  { category: "Transcript Processing", kw: ["transcript", "recording", "call summary", "post-call", "post call"] },
  { category: "Follow-Up Campaign", kw: ["follow up", "follow-up", "nurture", "campaign", "reminder"] },
  { category: "WhatsApp Automation", kw: ["whatsapp", "wati", "wa message"] },
  { category: "Notification", kw: ["notify", "notification", "alert", "email send", "slack message"] },
  { category: "Call Transfer", kw: ["transfer", "escalat", "handoff", "hand off"] },
  { category: "Knowledge Base", kw: ["knowledge", "faq", "rag", "retrieval", "vector"] },
  { category: "Reporting", kw: ["report", "analytics", "dashboard", "metric", "kpi"] },
  { category: "Data Sync", kw: ["sync", "etl", "import", "export", "migrate"] },
];

export function classifyRowHeuristic(row: any): WorkflowClassification {
  const name = String(row?.name ?? "");
  const folder = String(row?.folder ?? "");
  const tags: string[] = row?.tags ?? [];
  const integrations: string[] = row?.integrations ?? [];
  const u = row?.understanding ?? {};
  const haystack = [
    name,
    folder,
    tags.join(" "),
    integrations.join(" "),
    u.purpose ?? "",
    u.business_summary ?? "",
  ].join(" ");
  const signals: string[] = [];

  // ── Template type ──
  let type: TemplateType = "reusable_template";
  const tenantCount = (u.tenant_specific_values ?? []).length;
  const reusableCount = (u.reusable_components ?? []).length;

  if (includesAny(haystack, ["archive", "backup", "do not use", "obsolete"])) {
    type = "archive";
    signals.push("name/folder marks it archived");
  } else if (includesAny(haystack, ["legacy", "deprecated", "old ", " v1", "retired"])) {
    type = "legacy";
    signals.push("name/folder marks it legacy/deprecated");
  } else if (includesAny(haystack, ["test", "experiment", "wip", "draft", "poc", "sandbox", "demo", "copy of"])) {
    type = "experimental";
    signals.push("name/folder suggests experimental/test");
  } else if (!row?.active && (row?.node_count ?? 0) <= 3) {
    type = "experimental";
    signals.push("inactive and tiny — likely a stub/experiment");
  } else if (tenantCount >= 4 && tenantCount > reusableCount) {
    type = "customer_specific";
    signals.push(`${tenantCount} tenant-specific values dominate`);
  } else {
    type = "reusable_template";
    signals.push(reusableCount > 0 ? `${reusableCount} reusable components detected` : "generic structure");
  }

  // ── Business category ──
  let category = "General";
  for (const { category: cat, kw } of CATEGORY_KEYWORDS) {
    if (includesAny(haystack, kw)) {
      category = cat;
      signals.push(`category keywords → ${cat}`);
      break;
    }
  }

  // Confidence: heuristic is coarse; lean on understanding confidence when present.
  const uConf = typeof u.confidence === "number" ? u.confidence : 40;
  const confidence = Math.min(90, Math.round(uConf * 0.6 + (category !== "General" ? 20 : 5) + 15));

  return {
    type,
    category,
    reasoning: signals.join("; ") || "default heuristic classification",
    signals,
    confidence,
    auto: true,
    snapshot_updated_at: row?.n8n_updated_at ?? null,
  };
}

async function gptMini(apiKey: string, messages: Array<{ role: string; content: string }>): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, max_tokens: 400, temperature: 0.2 }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
  const json = (await res.json()) as any;
  return (json.choices?.[0]?.message?.content as string) ?? "";
}

function parseJsonLoose(raw: string): any {
  try {
    return JSON.parse(raw.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim());
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
    return null;
  }
}

/** AI-refined classification. Falls back to heuristic on any failure. */
export async function classifyRowAI(row: any, apiKey: string): Promise<WorkflowClassification> {
  const base = classifyRowHeuristic(row);
  if (!apiKey) return base;
  try {
    const u = row?.understanding ?? {};
    const prompt = `Classify this automation workflow.

Name: ${row?.name}
Active: ${row?.active}
Folder: ${row?.folder ?? "none"}
Tags: ${(row?.tags ?? []).join(", ") || "none"}
Integrations: ${(row?.integrations ?? []).join(", ") || "none"}
Purpose: ${u.purpose ?? ""}
Business summary: ${u.business_summary ?? ""}
Tenant-specific values: ${(u.tenant_specific_values ?? []).join("; ") || "none"}
Reusable components: ${(u.reusable_components ?? []).join("; ") || "none"}

template_type MUST be one of: ${TEMPLATE_TYPES.join(", ")}
category SHOULD be one of: ${WORKFLOW_CATEGORIES.join(", ")}

Return ONLY JSON: {"template_type":"...","category":"...","reasoning":"one line","confidence":0-100}`;
    const raw = await gptMini(apiKey, [
      { role: "system", content: "You classify automation workflows. Return ONLY valid JSON." },
      { role: "user", content: prompt },
    ]);
    const parsed = parseJsonLoose(raw);
    if (!parsed) return base;
    const type = TEMPLATE_TYPES.includes(parsed.template_type) ? parsed.template_type : base.type;
    const category = typeof parsed.category === "string" && parsed.category.trim() ? parsed.category.trim() : base.category;
    let conf = Number(parsed.confidence);
    if (!Number.isFinite(conf)) conf = base.confidence;
    conf = Math.min(100, Math.max(0, Math.round(conf)));
    return {
      type,
      category,
      reasoning: String(parsed.reasoning ?? base.reasoning).slice(0, 500),
      signals: [...base.signals, "AI refined"],
      confidence: conf,
      auto: true,
      snapshot_updated_at: row?.n8n_updated_at ?? null,
    };
  } catch {
    return base;
  }
}

async function persistClassification(
  workspaceId: string,
  id: string,
  cls: WorkflowClassification,
  classifiedBy: string | null,
) {
  const sb = supabaseAdmin as any;
  const { error } = await sb
    .from("systemmind_n8n_workflows")
    .update({
      template_type: cls.type,
      workflow_category: cls.category,
      classification: cls,
      classified_at: new Date().toISOString(),
      classified_by: classifiedBy,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Classify one workflow with AI refinement and persist. */
export async function classifyWorkflow(workspaceId: string, id: string, apiKey: string) {
  const sb = supabaseAdmin as any;
  const { data: row, error } = await sb
    .from("systemmind_n8n_workflows")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("Workflow not found");
  const cls = await classifyRowAI(row, apiKey);
  await persistClassification(workspaceId, id, cls, null);
  return cls;
}

/** Batch heuristic classification of all not-yet-classified workflows. */
export async function classifyAllWorkflows(workspaceId: string, force = false) {
  const sb = supabaseAdmin as any;
  const { data: rows, error } = await sb
    .from("systemmind_n8n_workflows")
    .select("*")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
  let classified = 0;
  for (const row of (rows ?? []) as any[]) {
    if (!force && row.template_type) continue;
    try {
      const cls = classifyRowHeuristic(row);
      await persistClassification(workspaceId, row.id, cls, null);
      classified += 1;
    } catch { /* skip individual failures */ }
  }
  return { classified, total: (rows ?? []).length };
}

/** Admin override of a workflow's classification. */
export async function setWorkflowClassification(
  workspaceId: string,
  id: string,
  type: TemplateType,
  category: string,
  userId: string,
) {
  if (!TEMPLATE_TYPES.includes(type)) throw new Error("Invalid template type");
  const sb = supabaseAdmin as any;
  const { data: row } = await sb
    .from("systemmind_n8n_workflows")
    .select("n8n_updated_at")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  const cls: WorkflowClassification = {
    type,
    category: category || "General",
    reasoning: "Manually set by admin",
    signals: ["admin override"],
    confidence: 100,
    auto: false,
    snapshot_updated_at: row?.n8n_updated_at ?? null,
  };
  await persistClassification(workspaceId, id, cls, userId);
  return cls;
}

/** Discovered workflows with their classification — powers the picker + review UI. */
export async function listWorkflowsForTemplates(workspaceId: string) {
  const sb = supabaseAdmin as any;
  const { data, error } = await sb
    .from("systemmind_n8n_workflows")
    .select(
      "id, name, active, folder, tags, integrations, node_count, confidence, understood_at, template_type, workflow_category, classification",
    )
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ── Structure snapshot (identity only — safe for export) ──────────────────────

function prettify(type: string): string {
  return String(type).replace(/^@?n8n-nodes(-base)?[./]/, "").replace(/^@n8n\/n8n-nodes-langchain\./, "LangChain: ");
}

export function buildStructure(row: any): { nodes: any[]; edges: any[]; order: string[] } {
  const raw = row?.raw_snapshot ?? {};
  const meta = row?.metadata ?? {};
  const nodes: any[] = Array.isArray(raw?.nodes) ? raw.nodes : [];
  const connections: Record<string, any> = raw?.connections ?? {};

  const outNodes = nodes.map((n: any) => ({
    id: String(n?.id ?? n?.name ?? ""),
    name: String(n?.name ?? n?.id ?? "node"),
    type: prettify(String(n?.type ?? "")),
  }));

  const edges: Array<{ from: string; to: string }> = [];
  for (const [src, conn] of Object.entries(connections)) {
    const main = (conn as any)?.main;
    if (!Array.isArray(main)) continue;
    for (const branch of main) {
      if (!Array.isArray(branch)) continue;
      for (const link of branch) {
        const to = link?.node ? String(link.node) : "";
        if (to) edges.push({ from: String(src), to });
      }
    }
  }
  return { nodes: outNodes, edges, order: (meta.executionOrder ?? []).slice(0, 200) };
}

// ── Template attribute derivation ─────────────────────────────────────────────

function deriveRiskRating(row: any, deploymentVariables: DeploymentVariable[]): "low" | "medium" | "high" {
  const secrets = deploymentVariables.filter((v) => v.category === "secret" || v.category === "credential").length;
  const secConcerns = (row?.understanding?.security_considerations ?? []).length;
  if (secrets >= 4 || secConcerns >= 4) return "high";
  if (secrets >= 1 || secConcerns >= 1) return "medium";
  return "low";
}

function deriveReadiness(row: any): "not_ready" | "needs_review" | "ready" {
  const conf = row?.understanding?.confidence ?? row?.confidence ?? 0;
  if (!row?.understanding) return "not_ready";
  if (conf >= 75) return "ready";
  return "needs_review";
}

// ── Template CRUD + lifecycle ─────────────────────────────────────────────────

const TEMPLATE_COLUMNS =
  "id, name, description, category, template_type, status, is_trusted, confidence, readiness, risk_rating, tags, current_version, updated_at, created_at";

export async function listTemplates(
  workspaceId: string,
  filters: { category?: string; status?: string; templateType?: string; tag?: string; search?: string } = {},
) {
  const sb = supabaseAdmin as any;
  let q = sb
    .from("systemmind_workflow_templates")
    .select(TEMPLATE_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (filters.category) q = q.eq("category", filters.category);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.templateType) q = q.eq("template_type", filters.templateType);
  if (filters.tag) q = q.contains("tags", [filters.tag]);
  if (filters.search) q = q.ilike("name", `%${filters.search}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getTemplateDetail(workspaceId: string, id: string) {
  const sb = supabaseAdmin as any;
  const { data: template, error } = await sb
    .from("systemmind_workflow_templates")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!template) return null;
  const { data: versions } = await sb
    .from("systemmind_template_versions")
    .select("id, version, status, change_note, created_at, created_by")
    .eq("workspace_id", workspaceId)
    .eq("template_id", id)
    .order("version", { ascending: false });
  return { template, versions: versions ?? [] };
}

async function snapshotVersion(
  sb: any,
  workspaceId: string,
  template: any,
  version: number,
  changeNote: string,
  userId: string | null,
) {
  await sb.from("systemmind_template_versions").insert({
    workspace_id: workspaceId,
    template_id: template.id,
    version,
    snapshot: template,
    status: template.status,
    change_note: changeNote,
    created_by: userId,
  });
}

/** Build a curated draft template from a discovered n8n workflow. */
export async function createTemplateFromWorkflow(
  workspaceId: string,
  workflowId: string,
  userId: string,
) {
  const sb = supabaseAdmin as any;
  const { data: row, error } = await sb
    .from("systemmind_n8n_workflows")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", workflowId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("Workflow not found");

  // Ensure classification exists (heuristic is enough here).
  let cls: WorkflowClassification = row.classification ?? classifyRowHeuristic(row);
  if (!row.template_type) {
    try { await persistClassification(workspaceId, workflowId, cls, null); } catch { /* non-fatal */ }
  }

  const u = row.understanding ?? {};
  const meta = row.metadata ?? {};
  const deploymentVariables = extractParameters(row);
  const structure = buildStructure(row);
  const services: string[] = [
    ...(meta.integrations ?? []),
    ...(u.required_services ?? []),
  ];
  const providers = categorizeProviders(services);

  const payload = {
    workspace_id: workspaceId,
    name: String(row.name ?? "Untitled template"),
    description: u.business_summary ?? null,
    business_purpose: u.purpose ?? null,
    category: row.workflow_category ?? cls.category,
    template_type: row.template_type ?? cls.type,
    status: "draft",
    is_trusted: false,
    confidence: typeof u.confidence === "number" ? u.confidence : row.confidence ?? null,
    readiness: deriveReadiness(row),
    risk_rating: deriveRiskRating(row, deploymentVariables),
    known_limitations: (u.failure_points ?? []).slice(0, 20),
    supported_agent_providers: providers.agent,
    supported_crm_providers: providers.crm,
    supported_calendar_providers: providers.calendar,
    supported_telephony_providers: providers.telephony,
    supported_messaging_providers: providers.messaging,
    required_apis: (meta.integrations ?? []).slice(0, 40),
    required_credentials: (meta.credentialTypes ?? []).slice(0, 40),
    deployment_variables: deploymentVariables,
    business_summary: u.business_summary ?? null,
    technical_summary: u.technical_summary ?? null,
    dependencies: [
      ...(u.dependencies ?? []),
      ...((meta.dependencies ?? []) as any[]).map((d: any) => `${d.type}: ${d.ref}`),
    ].slice(0, 30),
    linked_n8n_workflow_ids: [row.id],
    linked_builder_template_ids: [],
    linked_retell_agent_ids: [],
    structure,
    tags: (row.tags ?? []).slice(0, 30),
    source_kind: "n8n",
    current_version: 1,
    created_by: userId,
  };

  const { data: template, error: insErr } = await sb
    .from("systemmind_workflow_templates")
    .insert(payload)
    .select("*")
    .single();
  if (insErr) throw new Error(`Failed to create template: ${insErr.message}`);
  await snapshotVersion(sb, workspaceId, template, 1, "Created from n8n workflow", userId);
  return template;
}

const EDITABLE_FIELDS = new Set([
  "name", "description", "business_purpose", "category", "template_type",
  "confidence", "readiness", "risk_rating", "known_limitations",
  "supported_agent_providers", "supported_crm_providers", "supported_calendar_providers",
  "supported_telephony_providers", "supported_messaging_providers",
  "required_apis", "required_credentials", "deployment_variables",
  "business_summary", "technical_summary", "dependencies",
  "linked_builder_template_ids", "linked_retell_agent_ids", "tags",
]);

/**
 * Edit template fields. Never touches is_trusted/status directly. Editing an
 * already-approved template resets it to draft (re-approval required).
 */
export async function updateTemplate(
  workspaceId: string,
  id: string,
  patch: Record<string, any>,
  userId: string,
) {
  const sb = supabaseAdmin as any;
  const { data: current } = await sb
    .from("systemmind_workflow_templates")
    .select("status")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (!current) throw new Error("Template not found");

  const update: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(patch)) {
    if (EDITABLE_FIELDS.has(k)) update[k] = v;
  }
  // Editing invalidates a prior approval.
  if (current.status === "approved") {
    update.status = "draft";
    update.is_trusted = false;
    update.approved_by = null;
    update.approved_at = null;
  }
  const { data, error } = await sb
    .from("systemmind_workflow_templates")
    .update(update)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function cloneTemplate(workspaceId: string, id: string, newName: string, userId: string) {
  const sb = supabaseAdmin as any;
  const { data: src, error } = await sb
    .from("systemmind_workflow_templates")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!src) throw new Error("Template not found");

  const { id: _id, created_at: _c, updated_at: _u, approved_at: _a, approved_by: _ab, ...rest } = src;
  const payload = {
    ...rest,
    name: newName || `Copy of ${src.name}`,
    status: "draft",
    is_trusted: false,
    approved_by: null,
    approved_at: null,
    current_version: 1,
    created_by: userId,
  };
  const { data: clone, error: insErr } = await sb
    .from("systemmind_workflow_templates")
    .insert(payload)
    .select("*")
    .single();
  if (insErr) throw new Error(insErr.message);
  await snapshotVersion(sb, workspaceId, clone, 1, `Cloned from "${src.name}"`, userId);
  return clone;
}

/** Portable export payload — no ids, no workspace, no timestamps. */
export async function exportTemplate(workspaceId: string, id: string) {
  const sb = supabaseAdmin as any;
  const { data: t, error } = await sb
    .from("systemmind_workflow_templates")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!t) throw new Error("Template not found");
  return {
    __webee_template__: 1,
    name: t.name,
    description: t.description,
    business_purpose: t.business_purpose,
    category: t.category,
    template_type: t.template_type,
    confidence: t.confidence,
    readiness: t.readiness,
    risk_rating: t.risk_rating,
    known_limitations: t.known_limitations,
    supported_agent_providers: t.supported_agent_providers,
    supported_crm_providers: t.supported_crm_providers,
    supported_calendar_providers: t.supported_calendar_providers,
    supported_telephony_providers: t.supported_telephony_providers,
    supported_messaging_providers: t.supported_messaging_providers,
    required_apis: t.required_apis,
    required_credentials: t.required_credentials,
    deployment_variables: t.deployment_variables, // already masked
    business_summary: t.business_summary,
    technical_summary: t.technical_summary,
    dependencies: t.dependencies,
    structure: t.structure, // identity only, no params
    tags: t.tags,
  };
}

/** Import a portable template — validated, forced to draft/untrusted, no linked ids. */
export async function importTemplate(workspaceId: string, payload: any, userId: string) {
  const { importedTemplateSchema } = await import("./systemmind-templates.schema");
  const parsed = importedTemplateSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Invalid template payload: ${parsed.error.issues[0]?.message ?? "schema error"}`);
  }
  const p = parsed.data;
  const sb = supabaseAdmin as any;
  const insert = {
    workspace_id: workspaceId,
    name: p.name,
    description: p.description ?? null,
    business_purpose: p.business_purpose ?? null,
    category: p.category ?? "General",
    template_type: p.template_type ?? "reusable_template",
    status: "draft",
    is_trusted: false,
    confidence: p.confidence ?? null,
    readiness: p.readiness ?? "needs_review",
    risk_rating: p.risk_rating ?? "medium",
    known_limitations: p.known_limitations ?? [],
    supported_agent_providers: p.supported_agent_providers ?? [],
    supported_crm_providers: p.supported_crm_providers ?? [],
    supported_calendar_providers: p.supported_calendar_providers ?? [],
    supported_telephony_providers: p.supported_telephony_providers ?? [],
    supported_messaging_providers: p.supported_messaging_providers ?? [],
    required_apis: p.required_apis ?? [],
    required_credentials: p.required_credentials ?? [],
    deployment_variables: p.deployment_variables ?? [],
    business_summary: p.business_summary ?? null,
    technical_summary: p.technical_summary ?? null,
    dependencies: p.dependencies ?? [],
    linked_n8n_workflow_ids: [],
    linked_builder_template_ids: [],
    linked_retell_agent_ids: [],
    structure: p.structure ?? {},
    tags: p.tags ?? [],
    source_kind: "import",
    current_version: 1,
    created_by: userId,
  };
  const { data: template, error } = await sb
    .from("systemmind_workflow_templates")
    .insert(insert)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await snapshotVersion(sb, workspaceId, template, 1, "Imported", userId);
  return template;
}

async function setStatus(
  workspaceId: string,
  id: string,
  patch: Record<string, any>,
): Promise<any> {
  const sb = supabaseAdmin as any;
  const { data, error } = await sb
    .from("systemmind_workflow_templates")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function submitTemplateForApproval(workspaceId: string, id: string) {
  return setStatus(workspaceId, id, { status: "pending_approval" });
}

/** The ONLY place is_trusted is set true. Bumps version + snapshots. */
export async function approveTemplate(workspaceId: string, id: string, userId: string) {
  const sb = supabaseAdmin as any;
  const { data: current } = await sb
    .from("systemmind_workflow_templates")
    .select("current_version")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (!current) throw new Error("Template not found");
  const nextVersion = (current.current_version ?? 1) + 1;
  const approved = await setStatus(workspaceId, id, {
    status: "approved",
    is_trusted: true,
    approved_by: userId,
    approved_at: new Date().toISOString(),
    current_version: nextVersion,
  });
  await snapshotVersion(sb, workspaceId, approved, nextVersion, "Approved — marked trusted", userId);
  return approved;
}

export async function rejectTemplate(workspaceId: string, id: string) {
  return setStatus(workspaceId, id, { status: "draft", is_trusted: false });
}

export async function archiveTemplate(workspaceId: string, id: string) {
  return setStatus(workspaceId, id, { status: "archived", is_trusted: false });
}

export async function deleteTemplate(workspaceId: string, id: string) {
  const sb = supabaseAdmin as any;
  const { error } = await sb
    .from("systemmind_workflow_templates")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) throw new Error(error.message);
  return { deleted: true };
}
