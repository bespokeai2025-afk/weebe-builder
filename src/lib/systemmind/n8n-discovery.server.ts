/**
 * SystemMind n8n Discovery & Understanding — SERVER ONLY.
 * Loaded dynamically inside createServerFn handlers.
 *
 * Read-only against n8n (see n8n-client.server.ts). Persists discovered
 * workflows + AI understanding to `systemmind_n8n_workflows`, upserted by
 * (workspace_id, n8n_workflow_id). Strictly additive — no existing SystemMind
 * table or business logic is touched.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  isN8nConfigured,
  getN8nBaseUrl,
  n8nListWorkflows,
  n8nGetWorkflow,
  type N8nWorkflowSummary,
} from "./n8n-client.server";
import { extractWorkflowMetadata, extractTags, extractFolder } from "./n8n-extract.server";

// ── Mini OpenAI chat helper (server-only) ────────────────────────────────────────
async function gptMini(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 1400,
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`OpenAI error ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as any;
  return (json.choices?.[0]?.message?.content as string) ?? "";
}

function parseJsonLoose(raw: string): any {
  try {
    return JSON.parse(raw.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim());
  } catch {
    // Try to extract the first {...} block.
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* fall through */ }
    }
    return null;
  }
}

// ── Connection status ────────────────────────────────────────────────────────────

export function getN8nConnectionStatus(): { configured: boolean; baseUrl: string } {
  return { configured: isN8nConfigured(), baseUrl: getN8nBaseUrl() };
}

// ── Row shaping ──────────────────────────────────────────────────────────────────

type StoredRow = {
  n8n_workflow_id: string;
  n8n_updated_at: string | null;
  understanding: any;
  confidence: number | null;
  ai_model: string | null;
  understood_at: string | null;
};

function buildRow(workspaceId: string, wf: N8nWorkflowSummary) {
  const meta = extractWorkflowMetadata(wf);
  const tags = extractTags(wf);
  const folder = extractFolder(wf);
  return {
    workspace_id: workspaceId,
    n8n_workflow_id: String(wf.id),
    name: String(wf.name ?? "Untitled").slice(0, 300),
    active: !!wf.active,
    folder,
    tags,
    trigger_types: meta.triggerTypes,
    node_count: meta.nodeCount,
    connection_count: meta.connectionCount,
    node_types: meta.nodeTypes.slice(0, 50),
    integrations: meta.integrations.slice(0, 50),
    has_webhook: meta.webhooks.length > 0,
    metadata: meta as any,
    raw_snapshot: wf as any,
    n8n_created_at: wf.createdAt ?? null,
    n8n_updated_at: wf.updatedAt ?? null,
    updated_at: new Date().toISOString(),
  };
}

// ── Scan + store (READ-ONLY against n8n) ─────────────────────────────────────────

export async function scanAndStoreN8nWorkflows(
  workspaceId: string,
): Promise<{ configured: boolean; scanned: number; upserted: number; baseUrl: string }> {
  if (!isN8nConfigured()) {
    return { configured: false, scanned: 0, upserted: 0, baseUrl: getN8nBaseUrl() };
  }
  const sb = supabaseAdmin as any;

  const workflows = await n8nListWorkflows();

  // Preserve existing AI understanding when a workflow's snapshot is unchanged.
  const { data: existingRows } = await sb
    .from("systemmind_n8n_workflows")
    .select("n8n_workflow_id, n8n_updated_at, understanding, confidence, ai_model, understood_at")
    .eq("workspace_id", workspaceId);
  const existingMap = new Map<string, StoredRow>();
  for (const r of (existingRows ?? []) as StoredRow[]) {
    existingMap.set(r.n8n_workflow_id, r);
  }

  let upserted = 0;
  for (const wf of workflows) {
    try {
      // Ensure we have the full definition (list usually includes nodes, but
      // fall back to a single GET if a summary came back without them).
      let full = wf;
      if (!Array.isArray(wf?.nodes) || wf.nodes.length === 0) {
        try { full = await n8nGetWorkflow(String(wf.id)); } catch { full = wf; }
      }

      const row = buildRow(workspaceId, full);
      const prior = existingMap.get(row.n8n_workflow_id);
      const unchanged =
        prior &&
        prior.understanding &&
        prior.n8n_updated_at &&
        row.n8n_updated_at &&
        prior.n8n_updated_at === row.n8n_updated_at;

      const finalRow = unchanged
        ? {
            ...row,
            understanding: prior!.understanding,
            confidence: prior!.confidence,
            ai_model: prior!.ai_model,
            understood_at: prior!.understood_at,
          }
        : { ...row, understanding: null, confidence: null, ai_model: null, understood_at: null };

      const { error } = await sb
        .from("systemmind_n8n_workflows")
        .upsert(finalRow, { onConflict: "workspace_id,n8n_workflow_id" });
      if (!error) upserted += 1;
    } catch {
      // Skip individual workflow failures; continue the scan.
    }
  }

  return { configured: true, scanned: workflows.length, upserted, baseUrl: getN8nBaseUrl() };
}

// ── List / detail ────────────────────────────────────────────────────────────────

const LIST_COLUMNS =
  "id, n8n_workflow_id, name, active, folder, tags, trigger_types, node_count, connection_count, integrations, has_webhook, confidence, understood_at, n8n_updated_at, discovered_at";

export async function listN8nWorkflows(workspaceId: string) {
  const sb = supabaseAdmin as any;
  const { data, error } = await sb
    .from("systemmind_n8n_workflows")
    .select(LIST_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getN8nWorkflowDetail(workspaceId: string, id: string) {
  const sb = supabaseAdmin as any;
  const { data, error } = await sb
    .from("systemmind_n8n_workflows")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

// ── AI understanding engine ──────────────────────────────────────────────────────

function summariseForPrompt(row: any): string {
  const meta = row.metadata ?? {};
  const nodeList = (meta.executionOrder ?? []).slice(0, 40).join(" → ");
  const creds = (meta.credentialTypes ?? []).join(", ");
  const http = (meta.httpRequests ?? [])
    .slice(0, 8)
    .map((h: any) => `${h.method} ${h.url}`)
    .join("; ");
  const webhooks = (meta.webhooks ?? [])
    .slice(0, 8)
    .map((w: any) => `${w.method} ${w.path}`)
    .join("; ");
  const reh = meta.retryErrorHandling ?? {};
  return [
    `Name: ${row.name}`,
    `Active: ${row.active}`,
    row.folder ? `Folder: ${row.folder}` : "",
    (row.tags ?? []).length ? `Tags: ${(row.tags ?? []).join(", ")}` : "",
    `Nodes (${row.node_count}), Connections (${row.connection_count})`,
    `Trigger types: ${(meta.triggerTypes ?? []).join(", ") || "none detected"}`,
    `Integrations / external services: ${(meta.integrations ?? []).join(", ") || "none"}`,
    `Node types: ${(meta.nodeTypes ?? []).slice(0, 30).join(", ")}`,
    `Execution order: ${nodeList}`,
    webhooks ? `Webhooks: ${webhooks}` : "",
    http ? `HTTP requests: ${http}` : "",
    creds ? `Credential types referenced: ${creds}` : "",
    `Expressions found: ${meta.expressions?.count ?? 0}`,
    (meta.dependencies ?? []).length
      ? `Sub-workflow dependencies: ${(meta.dependencies ?? []).map((d: any) => d.ref).join(", ")}`
      : "",
    `Retry: ${reh.nodesWithRetry ?? 0} node(s); Continue-on-fail: ${reh.nodesWithContinueOnFail ?? 0} node(s); Error workflow: ${reh.hasErrorWorkflow ? "yes" : "no"}`,
    `Inferred inputs: ${(meta.inputs ?? []).join(", ")}`,
    `Inferred outputs: ${(meta.outputs ?? []).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const UNDERSTANDING_SHAPE = `{
  "business_summary": "1-3 sentences: what this workflow does for the business, in plain language",
  "technical_summary": "1-3 sentences: how it works technically",
  "purpose": "one line",
  "trigger": "what starts it",
  "execution_flow": ["ordered step", "..."],
  "inputs": ["..."],
  "outputs": ["..."],
  "required_services": ["external services/APIs this depends on"],
  "dependencies": ["other workflows / systems it relies on"],
  "failure_points": ["where this could realistically break"],
  "retry_behaviour": "how it handles retries/errors",
  "security_considerations": ["auth, secrets, PII, exposure concerns"],
  "tenant_specific_values": ["values that are specific to one customer/tenant and would need changing to reuse"],
  "reusable_components": ["parts that look generic/reusable across tenants"],
  "confidence": 0
}`;

export async function understandN8nWorkflow(
  workspaceId: string,
  id: string,
  apiKey: string,
): Promise<any> {
  const sb = supabaseAdmin as any;
  const row = await getN8nWorkflowDetail(workspaceId, id);
  if (!row) throw new Error("Workflow not found");
  if (!apiKey) throw new Error("OpenAI API key not configured.");

  let knowledge = "";
  try {
    const { querySystemMindKnowledgeContext } = await import(
      "@/lib/systemmind/systemmind-workflow.server"
    );
    knowledge = await querySystemMindKnowledgeContext(
      workspaceId,
      `n8n workflow automation ${row.name} ${(row.integrations ?? []).join(" ")}`,
      apiKey,
    );
  } catch { /* graceful */ }

  const prompt = `You are SystemMind, WEBEE's AI CTO. Analyse this n8n automation workflow and produce a precise, grounded understanding. Do NOT invent capabilities that aren't evidenced by the structure below.

WORKFLOW STRUCTURE:
${summariseForPrompt(row)}
${knowledge ? `\nORGANISATION KNOWLEDGE (for grounding):\n${knowledge}\n` : ""}
Return ONLY valid JSON matching this shape (no markdown):
${UNDERSTANDING_SHAPE}

"confidence" is 0-100: how confident you are that this understanding is correct given the available structure. Lower it when the workflow is large, opaque, or relies on generic Code/HTTP nodes whose intent isn't clear.`;

  const raw = await gptMini(
    apiKey,
    [
      { role: "system", content: "Senior automation architect. Return ONLY valid JSON." },
      { role: "user", content: prompt },
    ],
    1500,
  );

  const parsed = parseJsonLoose(raw);
  if (!parsed) throw new Error("AI returned an unparseable response. Try again.");

  const understanding = {
    business_summary: String(parsed.business_summary ?? "").slice(0, 2000),
    technical_summary: String(parsed.technical_summary ?? "").slice(0, 2000),
    purpose: String(parsed.purpose ?? "").slice(0, 500),
    trigger: String(parsed.trigger ?? "").slice(0, 500),
    execution_flow: toStrArray(parsed.execution_flow),
    inputs: toStrArray(parsed.inputs),
    outputs: toStrArray(parsed.outputs),
    required_services: toStrArray(parsed.required_services),
    dependencies: toStrArray(parsed.dependencies),
    failure_points: toStrArray(parsed.failure_points),
    retry_behaviour: String(parsed.retry_behaviour ?? "").slice(0, 1000),
    security_considerations: toStrArray(parsed.security_considerations),
    tenant_specific_values: toStrArray(parsed.tenant_specific_values),
    reusable_components: toStrArray(parsed.reusable_components),
    confidence: clampConfidence(parsed.confidence),
  };

  const { error } = await sb
    .from("systemmind_n8n_workflows")
    .update({
      understanding,
      confidence: understanding.confidence,
      ai_model: "gpt-4o-mini",
      understood_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) throw new Error(error.message);

  return { understanding, confidence: understanding.confidence };
}

function toStrArray(v: any): string[] {
  if (!Array.isArray(v)) return typeof v === "string" && v.trim() ? [v.trim()] : [];
  return v.map((x) => String(x)).filter(Boolean).slice(0, 30);
}

function clampConfidence(v: any): number {
  let n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) n = 50;
  if (n > 0 && n <= 1) n = Math.round(n * 100); // tolerate 0-1 scale
  return Math.min(100, Math.max(0, Math.round(n)));
}
