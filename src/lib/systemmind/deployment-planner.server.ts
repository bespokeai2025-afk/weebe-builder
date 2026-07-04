/**
 * SystemMind Deployment Planner — SERVER ONLY (Task #298, spec step 2).
 * Loaded dynamically inside admin-gated createServerFn handlers.
 *
 * Turns a natural-language deployment request into a complete, DESCRIPTIVE
 * deployment plan by combining the curated Template Library, the CRM adapter
 * catalogue, the universal-action registry and the knowledge-graph summary.
 *
 * ⚠️ PLAN-ONLY. Nothing here deploys, provisions, imports, or executes anything.
 * Every stored plan carries execution_status = 'not_executed' (a DB default that
 * is NEVER updated) and requires_human_execution = true. This module deliberately
 * does NOT import any n8n / provider client — enrichment reads template columns
 * and static adapter definitions only.
 *
 * SECURITY: the OpenAI key is resolved by the caller from the server environment
 * (never client input). The AI is only allowed to *select from* a fixed candidate
 * set — returned template ids are whitelisted against that set (hallucinations are
 * dropped). Plans reference deployment-variable KEYS/labels only, never values.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isRelationMissing } from "@/lib/systemmind/confidence-engine.server";
import {
  listCrmAdapterDefinitions,
  getCrmAdapterDefinition,
} from "@/lib/systemmind/crm-definitions/registry";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PlanTemplateRef {
  id: string;
  name: string;
  category: string | null;
  status: string | null;
  confidence: number | null;
  risk_rating: string | null;
  recommended: boolean;
}

export interface PlanVariable {
  key: string;
  name: string;
  category: string;
  required: boolean;
}

export interface PlanAdapter {
  name: string;
  label: string;
  vendor: string;
  matched: boolean;
}

export interface PlanGraphPrerequisite {
  /** Selected template that has the dependency. */
  template: string;
  /** Node the template depends on / links to. */
  depends_on: string;
  node_type: string;
  /** Human-readable edge type (e.g. "depends on"). */
  edge: string;
}

export interface PlanGraphContext {
  /** True when the knowledge-graph tables exist and were queried. */
  consulted: boolean;
  /** True when a graph build has produced nodes. */
  build_present: boolean;
  /** How many selected templates were found as nodes in the graph. */
  matched_nodes: number;
  /** Edge-based prerequisites/links discovered for the selected templates. */
  prerequisites: PlanGraphPrerequisite[];
  /** Architecture nodes (infrastructure, APIs, integrations, adapters) reachable from the selection. */
  architecture: Array<{ label: string; node_type: string }>;
  /** Past failure-report nodes linked to the selected templates. */
  related_failures: string[];
  /** Graph-derived caveats surfaced to the human operator. */
  notes: string[];
}

export interface DeploymentPlanBody {
  interpreted_goal: string;
  summary: string;
  selected_templates: PlanTemplateRef[];
  required_apis: string[];
  required_adapters: PlanAdapter[];
  required_credentials: string[];
  providers: {
    agent: string[];
    crm: string[];
    calendar: string[];
    telephony: string[];
    messaging: string[];
  };
  configuration_variables: PlanVariable[];
  webhook_requirements: PlanVariable[];
  infrastructure_requirements: string[];
  deployment_order: Array<{ step: number; template: string; category: string | null; action: string }>;
  security_requirements: string[];
  validation_steps: string[];
  testing_steps: string[];
  risk_assessment: { rating: "low" | "medium" | "high"; notes: string[] };
  knowledge_graph: PlanGraphContext;
  estimated_minutes: number;
  requires_human_execution: true;
  execution_note: string;
}

export interface DeploymentPlanRecord {
  id: string;
  request_text: string;
  title: string | null;
  status: string;
  execution_status: string;
  plan: DeploymentPlanBody;
  required_template_ids: string[];
  confidence: number | null;
  risk_rating: string | null;
  estimated_minutes: number | null;
  generated_by: string;
  created_at: string;
  updated_at: string;
}

const EXECUTION_NOTE =
  "This is a descriptive plan only. SystemMind has NOT deployed, provisioned, or " +
  "executed anything, and will not do so automatically. A human operator must " +
  "review and carry out each step, supplying real values for every variable.";

const PLAN_COLUMNS =
  "id, name, description, business_purpose, category, status, is_trusted, readiness, confidence, risk_rating, " +
  "tags, supported_agent_providers, supported_crm_providers, supported_calendar_providers, " +
  "supported_telephony_providers, supported_messaging_providers, required_apis, required_credentials, " +
  "deployment_variables, dependencies, structure, current_version";

// ── AI helpers (selection only) ───────────────────────────────────────────────

async function gptSelect(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, max_tokens: 600, temperature: 0.2 }),
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

// ── Deterministic candidate matching (fallback + always-on filter) ────────────

function keywordScore(request: string, t: any): number {
  const req = request.toLowerCase();
  const hay = [
    t.name, t.category, t.business_purpose, t.description,
    (t.tags ?? []).join(" "),
    (t.supported_crm_providers ?? []).join(" "),
  ].join(" ").toLowerCase();
  const words = Array.from(new Set(req.split(/[^a-z0-9]+/).filter((w) => w.length >= 4)));
  let score = 0;
  for (const w of words) if (hay.includes(w)) score += 1;
  return score;
}

// ── Enrichment helpers ────────────────────────────────────────────────────────

const CATEGORY_ORDER: string[] = [
  "CRM Synchronisation", "Data Sync", "Knowledge Base",
  "Receptionist", "Appointment Booking", "Client Qualification", "Lead Generation", "Call Transfer",
  "Transcript Processing", "WhatsApp Automation", "Notification", "Follow-Up Campaign", "Reporting",
];

function orderIndex(category: string | null): number {
  const i = CATEGORY_ORDER.indexOf(String(category ?? ""));
  return i === -1 ? CATEGORY_ORDER.length : i;
}

function uniq(list: string[]): string[] {
  return Array.from(new Set(list.filter((v) => v != null && String(v).trim() !== "")));
}

function matchAdapters(crmProviders: string[]): PlanAdapter[] {
  const defs = listCrmAdapterDefinitions();
  const out: PlanAdapter[] = [];
  const seen = new Set<string>();
  for (const raw of uniq(crmProviders)) {
    const key = raw.toLowerCase();
    let def = getCrmAdapterDefinition(key);
    if (!def) {
      def = defs.find(
        (d) =>
          d.name.toLowerCase() === key ||
          d.label.toLowerCase().includes(key) ||
          d.vendor.toLowerCase().includes(key) ||
          key.includes(d.name.toLowerCase()),
      );
    }
    const name = def?.name ?? raw;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      label: def?.label ?? raw,
      vendor: def?.vendor ?? "unknown",
      matched: !!def,
    });
  }
  return out;
}

function collectVariables(selected: any[]): PlanVariable[] {
  const out: PlanVariable[] = [];
  const seen = new Set<string>();
  for (const t of selected) {
    for (const v of (t.deployment_variables ?? []) as any[]) {
      const key = String(v?.key ?? "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      // KEYS + labels only — never the (masked) example value.
      out.push({
        key,
        name: String(v?.name ?? key),
        category: String(v?.category ?? "config"),
        required: !!v?.required,
      });
    }
  }
  return out;
}

function bucketProviders(selected: any[]) {
  const b = { agent: [] as string[], crm: [] as string[], calendar: [] as string[], telephony: [] as string[], messaging: [] as string[] };
  for (const t of selected) {
    b.agent.push(...(t.supported_agent_providers ?? []));
    b.crm.push(...(t.supported_crm_providers ?? []));
    b.calendar.push(...(t.supported_calendar_providers ?? []));
    b.telephony.push(...(t.supported_telephony_providers ?? []));
    b.messaging.push(...(t.supported_messaging_providers ?? []));
  }
  return {
    agent: uniq(b.agent), crm: uniq(b.crm), calendar: uniq(b.calendar),
    telephony: uniq(b.telephony), messaging: uniq(b.messaging),
  };
}

function buildInfrastructure(providers: ReturnType<typeof bucketProviders>): string[] {
  const infra: string[] = ["n8n instance to host the imported workflow(s)", "Secret storage for credentials (never store secrets in the plan)"];
  if (providers.agent.length) infra.push("Voice/AI agent provider account with agent configuration");
  if (providers.telephony.length) infra.push("Telephony provider account and phone number(s)");
  if (providers.crm.length) infra.push("CRM account with API access");
  if (providers.calendar.length) infra.push("Calendar provider account and availability configuration");
  if (providers.messaging.length) infra.push("Messaging provider account (e.g. WhatsApp) with sender registration");
  return infra;
}

function buildSecurity(vars: PlanVariable[], selected: any[]): string[] {
  const out = [
    "Store every credential/secret in a secret manager — never in the plan, workflow files, or source control.",
    "Grant each provider the least privilege required; scope API keys to this workspace only.",
  ];
  const secrets = vars.filter((v) => v.category === "secret" || v.category === "credential");
  for (const s of secrets.slice(0, 20)) out.push(`Provision and rotate credential: ${s.name}`);
  if (vars.some((v) => v.category === "webhook")) {
    out.push("Restrict webhook endpoints and verify request signatures where the provider supports them.");
  }
  const secConcerns = uniq(selected.flatMap((t) => (t.known_limitations ?? []) as string[]))
    .filter((l) => /secur|secret|token|auth|gdpr|pii|privacy/i.test(l));
  for (const c of secConcerns.slice(0, 10)) out.push(`Review limitation: ${c}`);
  return out;
}

function buildValidation(providers: ReturnType<typeof bucketProviders>, vars: PlanVariable[]): string[] {
  const out = [
    "Confirm every required credential is present and valid before enabling the workflow.",
    "Replace every deployment-variable placeholder with the tenant's real value.",
  ];
  if (providers.crm.length) out.push("Validate the CRM connection with a test read/write on a sandbox record.");
  if (vars.some((v) => v.category === "webhook")) out.push("Verify each webhook endpoint receives and authenticates a test event.");
  if (providers.agent.length) out.push("Confirm the voice agent loads its prompt and knowledge base correctly.");
  if (providers.calendar.length) out.push("Confirm calendar availability and time zones resolve correctly.");
  return out;
}

function buildTesting(providers: ReturnType<typeof bucketProviders>): string[] {
  const out = ["Run an end-to-end test scenario that matches the original request."];
  if (providers.crm.length) out.push("Verify records are created/updated correctly in the CRM.");
  if (providers.calendar.length) out.push("Book a test appointment and confirm the calendar entry.");
  if (providers.messaging.length || providers.telephony.length) out.push("Confirm messages/calls reach the correct recipients.");
  out.push("Review execution logs for errors and confirm no step failed before going live.");
  return out;
}

function estimateMinutes(selected: any[], credentials: string[], providers: ReturnType<typeof bucketProviders>): number {
  const activeCategories = Object.values(providers).filter((b) => b.length > 0).length;
  return 20 + selected.length * 25 + credentials.length * 10 + activeCategories * 15;
}

function maxRisk(selected: any[]): "low" | "medium" | "high" {
  let r: "low" | "medium" | "high" = "low";
  for (const t of selected) {
    const tr = String(t.risk_rating ?? "low");
    if (tr === "high") return "high";
    if (tr === "medium") r = "medium";
  }
  return r;
}

// ── Confidence lookup (best-effort; falls back to template.confidence) ─────────

async function loadConfidenceMap(workspaceId: string): Promise<Map<string, { overall: number; risk: string }>> {
  const sb = supabaseAdmin as any;
  try {
    const { data, error } = await sb
      .from("systemmind_template_confidence")
      .select("template_id, overall_score, risk_rating")
      .eq("workspace_id", workspaceId);
    if (error) {
      if (isRelationMissing(error)) return new Map();
      throw new Error(error.message);
    }
    return new Map((data ?? []).map((c: any) => [c.template_id, { overall: c.overall_score, risk: c.risk_rating }]));
  } catch (e) {
    if (isRelationMissing(e)) return new Map();
    throw e;
  }
}

// ── Knowledge-graph consultation (READ-ONLY, descriptive) ─────────────────────
// The planner consults the SystemMind knowledge graph so that plan composition,
// deployment order, risk and architecture reflect real dependency edges — not
// just per-template metadata. This runs in BOTH the AI and deterministic paths,
// so graph signals are applied even when no OpenAI key is present. Read-only: it
// queries graph nodes/edges and never writes or executes anything.

const GRAPH_PREREQ_EDGES = new Set(["depends_on", "supported_by", "integrates_with", "uses_provider"]);
const GRAPH_ARCH_TYPES = new Set([
  "infrastructure", "api_connection", "api_endpoint", "integration", "crm_adapter", "universal_action", "deployment",
]);
const TEMPLATE_SOURCE_TABLE = "systemmind_workflow_templates";

const EDGE_LABELS: Record<string, string> = {
  depends_on: "depends on",
  supported_by: "supported by",
  integrates_with: "integrates with",
  uses_provider: "uses provider",
  belongs_to: "belongs to",
  maps_to_action: "maps to action",
  derived_from: "derived from",
  deployed_as: "deployed as",
};

interface GraphCtx {
  available: boolean;
  buildPresent: boolean;
  nodeById: Map<string, any>;
  adj: Map<string, any[]>;
  /** template row → graph node id (by source_table+source_id, then by label). */
  templateNodeId: (t: any) => string | undefined;
  /** graph node id → candidate template id (reverse of templateNodeId over candidates). */
  nodeIdToTemplateId: Map<string, string>;
}

async function loadGraphContext(workspaceId: string, candidates: any[]): Promise<GraphCtx> {
  const sb = supabaseAdmin as any;
  const empty: GraphCtx = {
    available: false, buildPresent: false, nodeById: new Map(), adj: new Map(),
    templateNodeId: () => undefined, nodeIdToTemplateId: new Map(),
  };
  try {
    const [nodesRes, edgesRes] = await Promise.all([
      sb.from("systemmind_graph_nodes")
        .select("id, node_type, source_table, source_id, label, status")
        .eq("workspace_id", workspaceId).limit(5000),
      sb.from("systemmind_graph_edges")
        .select("id, from_node_id, to_node_id, edge_type")
        .eq("workspace_id", workspaceId).limit(20000),
    ]);
    if (nodesRes.error) {
      if (isRelationMissing(nodesRes.error)) return empty;
      throw new Error(nodesRes.error.message);
    }
    if (edgesRes.error) {
      if (isRelationMissing(edgesRes.error)) return empty;
      throw new Error(edgesRes.error.message);
    }
    const nodes = (nodesRes.data ?? []) as any[];
    const edges = (edgesRes.data ?? []) as any[];
    const nodeById = new Map<string, any>(nodes.map((n) => [n.id, n]));
    const adj = new Map<string, any[]>();
    for (const e of edges) {
      if (!adj.has(e.from_node_id)) adj.set(e.from_node_id, []);
      if (!adj.has(e.to_node_id)) adj.set(e.to_node_id, []);
      adj.get(e.from_node_id)!.push(e);
      adj.get(e.to_node_id)!.push(e);
    }
    const bySource = new Map<string, string>();
    const byLabel = new Map<string, string>();
    for (const n of nodes) {
      if (n.source_table === TEMPLATE_SOURCE_TABLE && n.source_id) bySource.set(String(n.source_id), n.id);
      if (n.node_type === "workflow_template" && n.label) byLabel.set(String(n.label).toLowerCase(), n.id);
    }
    const templateNodeId = (t: any): string | undefined =>
      bySource.get(String(t.id)) ?? byLabel.get(String(t.name ?? "").toLowerCase());
    const nodeIdToTemplateId = new Map<string, string>();
    for (const t of candidates) {
      const nid = templateNodeId(t);
      if (nid) nodeIdToTemplateId.set(nid, t.id);
    }
    return { available: true, buildPresent: nodes.length > 0, nodeById, adj, templateNodeId, nodeIdToTemplateId };
  } catch (e) {
    if (isRelationMissing(e)) return empty;
    throw e;
  }
}

/** Direct prerequisite/link labels for a node — used to make AI selection graph-aware. */
function directPrereqLabels(graph: GraphCtx, nodeId: string | undefined): string[] {
  if (!nodeId) return [];
  const out: string[] = [];
  for (const e of graph.adj.get(nodeId) ?? []) {
    if (e.from_node_id !== nodeId) continue;
    if (!GRAPH_PREREQ_EDGES.has(e.edge_type)) continue;
    const to = graph.nodeById.get(e.to_node_id);
    if (to?.label) out.push(String(to.label));
  }
  return uniq(out).slice(0, 4);
}

interface GraphPlanResult {
  finalSelectedIds: string[];
  orderedIds: string[];
  addedPrerequisiteIds: string[];
  prerequisites: PlanGraphPrerequisite[];
  architecture: Array<{ label: string; node_type: string }>;
  relatedFailures: string[];
  notes: string[];
  matchedNodes: number;
  consulted: boolean;
  buildPresent: boolean;
}

/**
 * Consults the knowledge graph for an initial template selection: pulls in
 * edge-based prerequisite templates, orders the plan so prerequisites come
 * first, and surfaces architecture/failure context. Pure over the loaded graph.
 */
function consultGraphForPlan(selectedIds: string[], candidates: any[], graph: GraphCtx): GraphPlanResult {
  const byId = new Map<string, any>(candidates.map((t) => [t.id, t]));
  const notes: string[] = [];

  // 1. Auto-include prerequisite templates the selection depends on (graph edges).
  const selectedSet = new Set(selectedIds);
  const addedPrerequisiteIds: string[] = [];
  if (graph.available && graph.buildPresent) {
    for (const id of selectedIds) {
      const nid = graph.templateNodeId(byId.get(id));
      if (!nid) continue;
      for (const e of graph.adj.get(nid) ?? []) {
        if (e.from_node_id !== nid || e.edge_type !== "depends_on") continue;
        const prereqTemplateId = graph.nodeIdToTemplateId.get(e.to_node_id);
        if (prereqTemplateId && !selectedSet.has(prereqTemplateId) && addedPrerequisiteIds.length < 5) {
          selectedSet.add(prereqTemplateId);
          addedPrerequisiteIds.push(prereqTemplateId);
        }
      }
    }
  }
  const finalSelectedIds = [...selectedSet].filter((id) => byId.has(id));

  // 2. Map final selection → graph node ids.
  const nodeIdBySelected = new Map<string, string>();
  for (const id of finalSelectedIds) {
    const nid = graph.templateNodeId(byId.get(id));
    if (nid) nodeIdBySelected.set(id, nid);
  }
  const matchedNodes = nodeIdBySelected.size;
  const selectedNodeIds = new Set(nodeIdBySelected.values());

  // 3. BFS (depth 2) from matched selection to gather reachable context.
  const reachable = new Set<string>(selectedNodeIds);
  let frontier = [...selectedNodeIds];
  for (let d = 0; d < 2; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of graph.adj.get(id) ?? []) {
        const other = e.from_node_id === id ? e.to_node_id : e.from_node_id;
        if (!reachable.has(other)) { reachable.add(other); next.push(other); }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }

  // 4. Prerequisites/links, architecture nodes and failure reports.
  const prerequisites: PlanGraphPrerequisite[] = [];
  const seenPrereq = new Set<string>();
  for (const nid of selectedNodeIds) {
    const from = graph.nodeById.get(nid);
    for (const e of graph.adj.get(nid) ?? []) {
      if (e.from_node_id !== nid || !GRAPH_PREREQ_EDGES.has(e.edge_type)) continue;
      const to = graph.nodeById.get(e.to_node_id);
      if (!to?.label) continue;
      const key = `${from?.label}|${to.label}|${e.edge_type}`;
      if (seenPrereq.has(key)) continue;
      seenPrereq.add(key);
      prerequisites.push({
        template: String(from?.label ?? "template"),
        depends_on: String(to.label),
        node_type: String(to.node_type),
        edge: EDGE_LABELS[e.edge_type] ?? String(e.edge_type),
      });
    }
  }
  const architecture: Array<{ label: string; node_type: string }> = [];
  const seenArch = new Set<string>();
  const relatedFailures: string[] = [];
  const seenFail = new Set<string>();
  for (const nid of reachable) {
    if (selectedNodeIds.has(nid)) continue;
    const n = graph.nodeById.get(nid);
    if (!n?.label) continue;
    if (GRAPH_ARCH_TYPES.has(n.node_type) && !seenArch.has(n.label) && architecture.length < 25) {
      seenArch.add(n.label);
      architecture.push({ label: String(n.label), node_type: String(n.node_type) });
    }
    if (n.node_type === "failure_report" && !seenFail.has(n.label) && relatedFailures.length < 10) {
      seenFail.add(n.label);
      relatedFailures.push(String(n.label));
    }
  }

  // 5. Graph-aware deployment order: prerequisites before dependents (topological).
  const before = new Map<string, Set<string>>(); // templateId → prerequisite templateIds (must come first)
  for (const id of finalSelectedIds) before.set(id, new Set());
  for (const [depTemplateId, nid] of nodeIdBySelected) {
    for (const e of graph.adj.get(nid) ?? []) {
      if (e.from_node_id !== nid || e.edge_type !== "depends_on") continue;
      const prereqTemplateId = graph.nodeIdToTemplateId.get(e.to_node_id);
      if (prereqTemplateId && selectedSet.has(prereqTemplateId) && prereqTemplateId !== depTemplateId) {
        before.get(depTemplateId)!.add(prereqTemplateId);
      }
    }
  }
  const orderedIds = topoOrder(finalSelectedIds, before, byId);

  // 6. Notes / caveats.
  if (!graph.available) {
    notes.push("Knowledge graph is not available in this workspace — deployment order and prerequisites use template metadata only.");
  } else if (!graph.buildPresent) {
    notes.push("Knowledge graph has not been built yet — rebuild it for dependency-aware planning.");
  } else if (matchedNodes === 0) {
    notes.push("Selected templates are not yet represented in the knowledge graph — rebuild the graph to enable dependency-aware ordering.");
  } else {
    notes.push(`Knowledge graph consulted: ${matchedNodes} selected template(s) matched as graph nodes.`);
    if (prerequisites.length) notes.push(`${prerequisites.length} dependency/link edge(s) found across the selected templates.`);
    if (addedPrerequisiteIds.length) notes.push(`Auto-included ${addedPrerequisiteIds.length} prerequisite template(s) the selection depends on (per the graph).`);
    if (architecture.length) notes.push(`${architecture.length} related architecture node(s) (infrastructure/APIs/integrations) linked to the selection.`);
    if (relatedFailures.length) notes.push(`${relatedFailures.length} past failure report(s) linked to the selected templates — review before deploying.`);
  }

  return {
    finalSelectedIds, orderedIds, addedPrerequisiteIds, prerequisites, architecture,
    relatedFailures, notes, matchedNodes, consulted: graph.available, buildPresent: graph.buildPresent,
  };
}

/** Kahn topological sort; ties broken by category order then original position; cycle-safe. */
function topoOrder(ids: string[], before: Map<string, Set<string>>, byId: Map<string, any>): string[] {
  const pos = new Map<string, number>(ids.map((id, i) => [id, i]));
  const tie = (a: string, b: string): number => {
    const oa = orderIndex(byId.get(a)?.category ?? null);
    const ob = orderIndex(byId.get(b)?.category ?? null);
    if (oa !== ob) return oa - ob;
    return (pos.get(a) ?? 0) - (pos.get(b) ?? 0);
  };
  const remaining = new Set(ids);
  const out: string[] = [];
  while (remaining.size) {
    const ready = [...remaining].filter((id) =>
      [...(before.get(id) ?? [])].every((p) => !remaining.has(p)),
    );
    // Cycle guard: if nothing is ready, release the best tie-break candidate.
    const pick = (ready.length ? ready : [...remaining]).sort(tie)[0];
    out.push(pick);
    remaining.delete(pick);
  }
  return out;
}

// ── Core: generate a plan ──────────────────────────────────────────────────────

export async function generateDeploymentPlan(
  workspaceId: string,
  requestText: string,
  threshold: number,
  apiKey: string,
): Promise<DeploymentPlanRecord> {
  const request = String(requestText ?? "").trim();
  if (!request) throw new Error("A deployment request is required.");

  const sb = supabaseAdmin as any;
  const { data: templates, error } = await sb
    .from("systemmind_workflow_templates")
    .select(PLAN_COLUMNS)
    .eq("workspace_id", workspaceId)
    .neq("status", "archived")
    .limit(500);
  if (error) throw new Error(error.message);
  const all = (templates ?? []) as any[];
  if (all.length === 0) {
    throw new Error("No workflow templates are available yet. Curate templates in the Template Library first.");
  }

  const confMap = await loadConfidenceMap(workspaceId);
  const scoreOf = (t: any): number => confMap.get(t.id)?.overall ?? (typeof t.confidence === "number" ? t.confidence : 0);
  const isRecommended = (t: any) => scoreOf(t) >= threshold;

  // Candidate set (id-whitelist source of truth). Prefer recommended, but keep
  // all non-archived templates as candidates so the AI can still assemble a plan.
  const candidates = [...all].sort((a, b) => scoreOf(b) - scoreOf(a));
  const candidateIds = new Set(candidates.map((t) => t.id));

  // Consult the knowledge graph up front so selection (AI) and composition,
  // ordering, risk & architecture (deterministic) are all dependency-aware.
  const graph = await loadGraphContext(workspaceId, candidates);

  // 1. Select templates (AI when a key is present, deterministic otherwise).
  let selectedIds: string[] = [];
  let interpretedGoal = "";
  let title = "";
  let generatedBy: "ai" | "heuristic" = "heuristic";

  if (apiKey) {
    try {
      const candidateList = candidates
        .slice(0, 60)
        .map((t) => {
          const deps = directPrereqLabels(graph, graph.templateNodeId(t));
          const depHint = deps.length ? ` | graph-links:${deps.join(", ")}` : "";
          return `- id:${t.id} | ${t.name} | category:${t.category ?? "General"} | score:${scoreOf(t)}${isRecommended(t) ? " (recommended)" : ""} | purpose:${String(t.business_purpose ?? t.description ?? "").slice(0, 120)}${depHint}`;
        })
        .join("\n");
      const crmNames = listCrmAdapterDefinitions().map((d) => d.label).join(", ");
      const prompt = `A platform admin wants to plan (NOT execute) a deployment.

Request:
"""${request.slice(0, 2000)}"""

Available workflow templates (choose ONLY from these ids). "graph-links" lists dependencies/integrations discovered in the knowledge graph — prefer selections whose prerequisites are also included:
${candidateList}

Available CRM adapters: ${crmNames}

Pick the templates that together fulfil the request. Prefer higher-scored / recommended ones and include prerequisite templates named in graph-links. Return ONLY JSON:
{"title":"short title","interpreted_goal":"one sentence restating the goal","template_ids":["<id>", ...]}`;
      const raw = await gptSelect(apiKey, [
        { role: "system", content: "You assemble descriptive deployment plans by selecting existing templates. Return ONLY valid JSON. Never invent template ids." },
        { role: "user", content: prompt },
      ]);
      const parsed = parseJsonLoose(raw);
      if (parsed && Array.isArray(parsed.template_ids)) {
        // Whitelist against the candidate set — drop hallucinated ids.
        selectedIds = parsed.template_ids.map(String).filter((id: string) => candidateIds.has(id));
        interpretedGoal = String(parsed.interpreted_goal ?? "").slice(0, 400);
        title = String(parsed.title ?? "").slice(0, 200);
        if (selectedIds.length > 0) generatedBy = "ai";
      }
    } catch {
      /* fall back to heuristic below */
    }
  }

  // 2. Deterministic fallback / top-up.
  if (selectedIds.length === 0) {
    const ranked = candidates
      .map((t) => ({ t, s: keywordScore(request, t) + (isRecommended(t) ? 1 : 0) }))
      .sort((a, b) => b.s - a.s);
    const hits = ranked.filter((r) => r.s > 0).slice(0, 6);
    selectedIds = (hits.length ? hits : ranked.slice(0, 3)).map((r) => r.t.id);
  }

  // 3. Consult the knowledge graph: pull in edge-based prerequisite templates,
  //    order prerequisites first, and gather architecture/failure context. This
  //    applies in BOTH the AI and deterministic paths.
  const graphResult = consultGraphForPlan(selectedIds, candidates, graph);
  selectedIds = graphResult.finalSelectedIds;
  const byId = new Map<string, any>(candidates.map((t) => [t.id, t]));
  // `orderedIds` is the final selection already sorted prerequisite-first.
  const selected = graphResult.orderedIds.map((id) => byId.get(id)).filter(Boolean) as any[];

  if (!interpretedGoal) interpretedGoal = request.slice(0, 400);
  if (!title) title = request.split(/[.\n]/)[0].slice(0, 80) || "Deployment plan";

  // 4. Deterministic enrichment (graph-aware where relevant).
  const providers = bucketProviders(selected);
  const requiredApis = uniq(selected.flatMap((t) => (t.required_apis ?? []) as string[]));
  const requiredCredentials = uniq(selected.flatMap((t) => (t.required_credentials ?? []) as string[]));
  const configVariables = collectVariables(selected);
  const webhookRequirements = configVariables.filter((v) => v.category === "webhook");
  const adapters = matchAdapters(providers.crm);
  // Merge graph-discovered architecture nodes into the infrastructure list.
  const infrastructure = uniq([
    ...buildInfrastructure(providers),
    ...graphResult.architecture.map((a) => `${a.label} (${a.node_type.replace(/_/g, " ")}, per knowledge graph)`),
  ]);
  const security = buildSecurity(configVariables, selected);
  const validation = buildValidation(providers, configVariables);
  const testing = buildTesting(providers);
  const estimatedMinutes = estimateMinutes(selected, requiredCredentials, providers);

  // Deployment order follows the graph-derived (prerequisite-first) ordering.
  const deploymentOrder = selected.map((t, i) => ({
    step: i + 1,
    template: t.name,
    category: t.category ?? null,
    action: `Import, configure, validate and test "${t.name}" (human-performed).`,
  }));

  const selectedRefs: PlanTemplateRef[] = selected.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category ?? null,
    status: t.status ?? null,
    confidence: scoreOf(t),
    risk_rating: confMap.get(t.id)?.risk ?? t.risk_rating ?? null,
    recommended: isRecommended(t),
  }));

  // Graph-linked past failures escalate risk to at least medium.
  const baseRating = maxRisk(selected);
  const rating: "low" | "medium" | "high" =
    graphResult.relatedFailures.length && baseRating === "low" ? "medium" : baseRating;
  const belowThreshold = selected.filter((t) => !isRecommended(t));
  const riskNotes: string[] = [];
  riskNotes.push(`${selected.length} template(s) selected; overall risk assessed as ${rating}.`);
  if (requiredCredentials.length) riskNotes.push(`${requiredCredentials.length} credential type(s) must be provisioned securely.`);
  if (belowThreshold.length) riskNotes.push(`${belowThreshold.length} selected template(s) score below the confidence threshold (${threshold}) — review carefully.`);
  if (adapters.some((a) => !a.matched)) riskNotes.push("Some CRM providers have no built-in adapter — a custom integration may be required.");
  // Fold knowledge-graph caveats (prerequisites, failures, build status) into the risk notes.
  for (const n of graphResult.notes) riskNotes.push(n);
  for (const f of graphResult.relatedFailures.slice(0, 5)) riskNotes.push(`Linked failure report: ${f}`);

  const planConfidence = selected.length
    ? Math.round(selected.reduce((n, t) => n + scoreOf(t), 0) / selected.length)
    : null;

  const body: DeploymentPlanBody = {
    interpreted_goal: interpretedGoal,
    summary:
      `Assembles ${selected.length} template(s) covering ${uniq(selected.map((t) => t.category)).join(", ") || "general"} ` +
      `to fulfil the request. Estimated human effort ~${estimatedMinutes} minutes. Descriptive plan only — not executed.`,
    selected_templates: selectedRefs,
    required_apis: requiredApis,
    required_adapters: adapters,
    required_credentials: requiredCredentials,
    providers,
    configuration_variables: configVariables,
    webhook_requirements: webhookRequirements,
    infrastructure_requirements: infrastructure,
    deployment_order: deploymentOrder,
    security_requirements: security,
    validation_steps: validation,
    testing_steps: testing,
    risk_assessment: { rating, notes: riskNotes },
    knowledge_graph: {
      consulted: graphResult.consulted,
      build_present: graphResult.buildPresent,
      matched_nodes: graphResult.matchedNodes,
      prerequisites: graphResult.prerequisites,
      architecture: graphResult.architecture,
      related_failures: graphResult.relatedFailures,
      notes: graphResult.notes,
    },
    estimated_minutes: estimatedMinutes,
    requires_human_execution: true,
    execution_note: EXECUTION_NOTE,
  };

  // 5. Persist. execution_status is left to its DB default ('not_executed').
  const { data: inserted, error: insErr } = await sb
    .from("systemmind_deployment_plans")
    .insert({
      workspace_id: workspaceId,
      request_text: request,
      title,
      status: "draft",
      plan: body,
      required_template_ids: selectedIds,
      confidence: planConfidence,
      risk_rating: rating,
      estimated_minutes: estimatedMinutes,
      generated_by: generatedBy,
    })
    .select("*")
    .single();
  if (insErr) {
    if (isRelationMissing(insErr)) throw new Error("MIGRATION_NOT_APPLIED");
    throw new Error(insErr.message);
  }
  return inserted as DeploymentPlanRecord;
}

// ── Plan CRUD (read/delete only; plans are never "executed") ──────────────────

export async function listDeploymentPlans(
  workspaceId: string,
): Promise<{ applied: boolean; plans: DeploymentPlanRecord[] }> {
  const sb = supabaseAdmin as any;
  try {
    const { data, error } = await sb
      .from("systemmind_deployment_plans")
      .select("id, request_text, title, status, execution_status, required_template_ids, confidence, risk_rating, estimated_minutes, generated_by, created_at, updated_at, plan")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) {
      if (isRelationMissing(error)) return { applied: false, plans: [] };
      throw new Error(error.message);
    }
    return { applied: true, plans: (data ?? []) as DeploymentPlanRecord[] };
  } catch (e) {
    if (isRelationMissing(e)) return { applied: false, plans: [] };
    throw e;
  }
}

export async function getDeploymentPlan(workspaceId: string, id: string): Promise<DeploymentPlanRecord | null> {
  const sb = supabaseAdmin as any;
  const { data, error } = await sb
    .from("systemmind_deployment_plans")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isRelationMissing(error)) return null;
    throw new Error(error.message);
  }
  return (data ?? null) as DeploymentPlanRecord | null;
}

export async function deleteDeploymentPlan(workspaceId: string, id: string): Promise<{ deleted: boolean }> {
  const sb = supabaseAdmin as any;
  const { error } = await sb
    .from("systemmind_deployment_plans")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) throw new Error(error.message);
  return { deleted: true };
}

// ── Readiness dashboard ────────────────────────────────────────────────────────

export interface ReadinessDashboard {
  applied: boolean;
  threshold: number;
  templates: {
    total: number;
    approved: number;
    ready: number;
    recommended: number;
    scored: number;
    stale: number;
    avg_overall: number;
    risk: { low: number; medium: number; high: number };
  };
  providers: { agent: number; crm: number; calendar: number; telephony: number; messaging: number };
  plans: { total: number; drafts: number };
}

export async function buildReadinessDashboard(workspaceId: string, threshold: number): Promise<ReadinessDashboard> {
  const sb = supabaseAdmin as any;
  const empty: ReadinessDashboard = {
    applied: false,
    threshold,
    templates: { total: 0, approved: 0, ready: 0, recommended: 0, scored: 0, stale: 0, avg_overall: 0, risk: { low: 0, medium: 0, high: 0 } },
    providers: { agent: 0, crm: 0, calendar: 0, telephony: 0, messaging: 0 },
    plans: { total: 0, drafts: 0 },
  };

  const { data: templates, error: tErr } = await sb
    .from("systemmind_workflow_templates")
    .select("id, status, readiness, current_version, supported_agent_providers, supported_crm_providers, supported_calendar_providers, supported_telephony_providers, supported_messaging_providers")
    .eq("workspace_id", workspaceId)
    .limit(500);
  if (tErr) throw new Error(tErr.message);
  const tpls = (templates ?? []) as any[];

  let confRows: any[] = [];
  let confApplied = true;
  try {
    const { data, error } = await sb
      .from("systemmind_template_confidence")
      .select("template_id, overall_score, risk_rating, template_current_version")
      .eq("workspace_id", workspaceId);
    if (error) {
      if (isRelationMissing(error)) confApplied = false;
      else throw new Error(error.message);
    } else confRows = data ?? [];
  } catch (e) {
    if (isRelationMissing(e)) confApplied = false;
    else throw e;
  }

  const confMap = new Map(confRows.map((c) => [c.template_id, c]));
  const providerSet = { agent: new Set<string>(), crm: new Set<string>(), calendar: new Set<string>(), telephony: new Set<string>(), messaging: new Set<string>() };
  let approved = 0, ready = 0, recommended = 0, stale = 0, overallSum = 0;
  const risk = { low: 0, medium: 0, high: 0 };

  for (const t of tpls) {
    if (t.status === "approved") approved += 1;
    if (t.readiness === "ready") ready += 1;
    for (const p of t.supported_agent_providers ?? []) providerSet.agent.add(p);
    for (const p of t.supported_crm_providers ?? []) providerSet.crm.add(p);
    for (const p of t.supported_calendar_providers ?? []) providerSet.calendar.add(p);
    for (const p of t.supported_telephony_providers ?? []) providerSet.telephony.add(p);
    for (const p of t.supported_messaging_providers ?? []) providerSet.messaging.add(p);
    const c = confMap.get(t.id);
    if (c) {
      overallSum += c.overall_score;
      if (c.overall_score >= threshold) recommended += 1;
      if ((c.template_current_version ?? 1) !== (t.current_version ?? 1)) stale += 1;
      const r = String(c.risk_rating) as keyof typeof risk;
      if (r in risk) risk[r] += 1;
    }
  }

  let plansTotal = 0, drafts = 0, plansApplied = true;
  try {
    const { data, error } = await sb
      .from("systemmind_deployment_plans")
      .select("status")
      .eq("workspace_id", workspaceId)
      .limit(1000);
    if (error) {
      if (isRelationMissing(error)) plansApplied = false;
      else throw new Error(error.message);
    } else {
      plansTotal = (data ?? []).length;
      drafts = (data ?? []).filter((p: any) => p.status === "draft").length;
    }
  } catch (e) {
    if (isRelationMissing(e)) plansApplied = false;
    else throw e;
  }

  const scored = confRows.length;
  return {
    applied: confApplied && plansApplied,
    threshold,
    templates: {
      total: tpls.length,
      approved, ready, recommended, scored, stale,
      avg_overall: scored ? Math.round(overallSum / scored) : 0,
      risk,
    },
    providers: {
      agent: providerSet.agent.size, crm: providerSet.crm.size, calendar: providerSet.calendar.size,
      telephony: providerSet.telephony.size, messaging: providerSet.messaging.size,
    },
    plans: { total: plansTotal, drafts },
  };
  void empty;
}

// ── Learning queue (discovered-but-not-curated workflows) ─────────────────────

export interface LearningQueueItem {
  id: string;
  name: string;
  active: boolean;
  reason: "unclassified" | "not_curated";
  workflow_category: string | null;
  confidence: number | null;
  suggested_action: string;
}

export async function listLearningQueue(
  workspaceId: string,
): Promise<{ applied: boolean; items: LearningQueueItem[] }> {
  const sb = supabaseAdmin as any;
  try {
    const { data: rows, error } = await sb
      .from("systemmind_n8n_workflows")
      .select("id, name, active, template_type, workflow_category, confidence")
      .eq("workspace_id", workspaceId)
      .limit(1000);
    if (error) {
      if (isRelationMissing(error)) return { applied: false, items: [] };
      throw new Error(error.message);
    }

    const { data: templates } = await sb
      .from("systemmind_workflow_templates")
      .select("linked_n8n_workflow_ids")
      .eq("workspace_id", workspaceId)
      .limit(500);
    const linked = new Set<string>();
    for (const t of templates ?? []) for (const id of t.linked_n8n_workflow_ids ?? []) linked.add(id);

    const items: LearningQueueItem[] = [];
    for (const r of (rows ?? []) as any[]) {
      if (!r.template_type) {
        items.push({
          id: r.id, name: r.name, active: !!r.active, reason: "unclassified",
          workflow_category: r.workflow_category ?? null, confidence: r.confidence ?? null,
          suggested_action: "Classify this workflow (template type + business category).",
        });
      } else if (!linked.has(r.id)) {
        items.push({
          id: r.id, name: r.name, active: !!r.active, reason: "not_curated",
          workflow_category: r.workflow_category ?? null, confidence: r.confidence ?? null,
          suggested_action: "Curate into the Template Library so it can be planned with.",
        });
      }
    }
    return { applied: true, items };
  } catch (e) {
    if (isRelationMissing(e)) return { applied: false, items: [] };
    throw e;
  }
}

// ── Suggested improvements (deterministic, from confidence gaps) ──────────────

export interface ImprovementSuggestion {
  template_id: string | null;
  template_name: string;
  dimension: string;
  severity: "low" | "medium" | "high";
  suggestion: string;
}

export async function listSuggestedImprovements(
  workspaceId: string,
  threshold: number,
): Promise<{ applied: boolean; items: ImprovementSuggestion[] }> {
  const { listTemplateConfidence } = await import("@/lib/systemmind/confidence-engine.server");
  const { applied, rows } = await listTemplateConfidence(workspaceId, threshold);
  if (!applied) return { applied: false, items: [] };

  const items: ImprovementSuggestion[] = [];
  const sev = (gap: number): "low" | "medium" | "high" => (gap >= 40 ? "high" : gap >= 20 ? "medium" : "low");

  for (const r of rows) {
    if (r.documentation < 55) items.push({ template_id: r.template_id, template_name: r.name, dimension: "documentation", severity: sev(70 - r.documentation), suggestion: `Add business/technical summary and known limitations to "${r.name}".` });
    if (r.understanding < 50) items.push({ template_id: r.template_id, template_name: r.name, dimension: "understanding", severity: sev(70 - r.understanding), suggestion: `Capture a clear business purpose (or re-run AI understanding) for "${r.name}".` });
    if (r.deployment_readiness < 50) items.push({ template_id: r.template_id, template_name: r.name, dimension: "deployment_readiness", severity: sev(70 - r.deployment_readiness), suggestion: `Extract deployment variables and a structure snapshot for "${r.name}".` });
    if (r.dependency < 50) items.push({ template_id: r.template_id, template_name: r.name, dimension: "dependency", severity: sev(70 - r.dependency), suggestion: `Reduce or document the external credentials/dependencies of "${r.name}".` });
    if (r.crm_portability < 40) items.push({ template_id: r.template_id, template_name: r.name, dimension: "crm_portability", severity: "low", suggestion: `Map additional CRM providers to broaden portability of "${r.name}".` });
    if (r.stale) items.push({ template_id: r.template_id, template_name: r.name, dimension: "staleness", severity: "medium", suggestion: `Re-score "${r.name}" — it changed since it was last scored.` });
    if (r.status === "approved" && r.overall_score < threshold) items.push({ template_id: r.template_id, template_name: r.name, dimension: "overall", severity: "high", suggestion: `Approved template "${r.name}" scores below the threshold (${threshold}) — review or improve it.` });
  }

  const order = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);
  return { applied: true, items };
}
