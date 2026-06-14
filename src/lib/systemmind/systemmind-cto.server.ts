// ── SystemMind CTO Dashboard — server-only logic ──────────────────────────────
// Import only inside createServerFn handlers (dynamic import) or from this file.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getProviderUsage } from "@/lib/providers/usage.server";

// ── Shared mini-chat helper ────────────────────────────────────────────────────
async function gpt(apiKey: string, system: string, user: string, maxTokens = 900): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: maxTokens,
      temperature: 0.5,
    }),
  });
  if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(`OpenAI ${res.status}: ${t.slice(0, 120)}`); }
  const j = (await res.json()) as any;
  return (j.choices?.[0]?.message?.content as string) ?? "";
}

async function gptJson<T>(apiKey: string, system: string, user: string, maxTokens = 1200): Promise<T> {
  const raw = await gpt(apiKey, system, user, maxTokens);
  try { return JSON.parse(raw.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim()) as T; }
  catch { return {} as T; }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type SystemMindIssue = {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  category: "provider" | "agent" | "reliability" | "security" | "configuration" | "knowledge";
  title: string;
  detail: string;
  fixable: boolean;
  fixHref?: string;
};

export type SystemMindProvider = {
  id: string;
  name: string;
  category: "ai" | "voice" | "telephony" | "crm" | "calendar" | "messaging" | "email" | "payment";
  displayName: string;
  status: "connected" | "disconnected" | "partial";
  keyPresent: boolean;
  lastChecked: string;
  fallback: string | null;
  cost: number;
  requests: number;
  errors: number;
  errorCount: number;
  errorRate: number;
  lastUsedAt: string | null;
  configHint: string;
};

export type ArchitectureLayer = {
  id: string;
  order: number;
  name: string;
  role: string;
  description: string;
  components: Array<{ name: string; status: "active" | "inactive" | "partial"; note?: string }>;
};

export type SystemMindCTOSettings = {
  persona: "professional" | "concise" | "friendly";
  morningBriefing: boolean;
  autoScanInterval: "off" | "daily" | "weekly";
  errorRateThreshold: number;
  costDailyThreshold: number;
  defaultAiModel: "gpt-4o-mini" | "gpt-4o" | "gpt-3.5-turbo";
  notificationsEnabled: boolean;
  providerPriority: string[];
};

// ── 1. Issues ─────────────────────────────────────────────────────────────────
export async function getSystemMindIssuesServer(workspaceId: string): Promise<SystemMindIssue[]> {
  const sb = supabaseAdmin as any;
  const { data: ws } = await sb.from("workspace_settings").select("*").eq("workspace_id", workspaceId).maybeSingle();
  const s = ws ?? {};
  const issues: SystemMindIssue[] = [];

  // Provider key checks
  if (!s.openai_api_key && !process.env.OPENAI_API_KEY) {
    issues.push({ id: "no-openai", severity: "critical", category: "provider", title: "OpenAI API key missing", detail: "No OpenAI key is configured. AI executives, embeddings, and all LLM features will not work.", fixable: true, fixHref: "/settings" });
  }
  if (!s.retell_workspace_id && !s.retell_default_agent_id && !process.env.RETELL_API_KEY) {
    issues.push({ id: "no-retell", severity: "high", category: "provider", title: "Retell not configured", detail: "No Retell workspace ID or API key. Voice agents cannot be deployed.", fixable: true, fixHref: "/settings" });
  }
  if (!s.elevenlabs_api_key) {
    issues.push({ id: "no-elevenlabs", severity: "medium", category: "provider", title: "ElevenLabs not connected", detail: "ElevenLabs API key is absent. Real-time voice (HyperStream) will fall back to Retell's default TTS.", fixable: true, fixHref: "/settings" });
  }
  if (!s.twilio_auth_token || !s.twilio_account_sid) {
    issues.push({ id: "no-twilio", severity: "medium", category: "provider", title: "Twilio telephony not configured", detail: "Missing Twilio SID/Auth Token. Outbound calls and SMS cannot be placed through Twilio.", fixable: true, fixHref: "/settings" });
  }
  if (!s.calcom_api_key) {
    issues.push({ id: "no-calcom", severity: "low", category: "configuration", title: "Cal.com not connected", detail: "No Cal.com API key. Appointment-booking flows will be unable to create calendar events.", fixable: true, fixHref: "/settings" });
  }
  if (!s.whatsapp_phone_id) {
    issues.push({ id: "no-whatsapp", severity: "low", category: "configuration", title: "WhatsApp channel inactive", detail: "No WhatsApp Phone ID configured. WhatsApp messaging agents will not receive or send messages.", fixable: true, fixHref: "/settings" });
  }

  // CRM disconnection checks
  if (!s.hubspot_api_key && !s.ghl_api_key) {
    issues.push({ id: "no-crm", severity: "medium", category: "configuration", title: "No CRM connected", detail: "Neither HubSpot nor GoHighLevel is connected. Agent conversations cannot be synced to a CRM.", fixable: true, fixHref: "/settings" });
  } else {
    if (!s.hubspot_api_key) {
      issues.push({ id: "no-hubspot", severity: "low", category: "configuration", title: "HubSpot not connected", detail: "HubSpot API key is absent. Agents relying on HubSpot CRM sync will not function.", fixable: true, fixHref: "/settings" });
    }
    if (!s.ghl_api_key) {
      issues.push({ id: "no-ghl", severity: "low", category: "configuration", title: "GoHighLevel not connected", detail: "GoHighLevel API key is absent. GHL-based CRM automations will not execute.", fixable: true, fixHref: "/settings" });
    }
  }

  // Agent workflow structural analysis (mirrors analyzeWorkflowRepair deterministic checks)
  try {
    const { data: agents } = await sb.from("agents").select("id, name, flow_data").eq("workspace_id", workspaceId);
    if (agents) {
      for (const agent of agents) {
        const flowData = agent.flow_data ?? {};
        const nodes: any[] = Array.isArray(flowData.nodes) ? flowData.nodes : [];
        const edges: any[] = Array.isArray(flowData.edges) ? flowData.edges : [];
        if (nodes.length === 0) {
          issues.push({ id: `wf-empty-${agent.id}`, severity: "high", category: "agent", title: `Empty flow: "${agent.name}"`, detail: "Agent has no flow nodes. It cannot handle any conversation.", fixable: true, fixHref: "/systemmind/workflows" });
          continue;
        }
        // Build in/out degree maps
        const inDeg = new Map<string, number>();
        const outDeg = new Map<string, number>();
        for (const n of nodes) { inDeg.set(n.id, 0); outDeg.set(n.id, 0); }
        for (const e of edges) {
          inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
          outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1);
        }
        // Missing / ambiguous entry point
        const startNodes = nodes.filter((n) => (inDeg.get(n.id) ?? 0) === 0 && String(n.type ?? "").toLowerCase() !== "end");
        if (nodes.length > 1 && startNodes.length === 0) {
          issues.push({ id: `wf-no-start-${agent.id}`, severity: "critical", category: "agent", title: `No entry point: "${agent.name}"`, detail: "Every node has at least one incoming edge (loop). The flow will never start.", fixable: true, fixHref: "/systemmind/workflows" });
        } else if (startNodes.length > 1) {
          issues.push({ id: `wf-multi-start-${agent.id}`, severity: "high", category: "agent", title: `Ambiguous entry: "${agent.name}"`, detail: `${startNodes.length} nodes have no incoming edges. The provider may pick the wrong entry point.`, fixable: true, fixHref: "/systemmind/workflows" });
        }
        // Missing end node
        const endNodes = nodes.filter((n) => (outDeg.get(n.id) ?? 0) === 0);
        if (endNodes.length === 0) {
          issues.push({ id: `wf-no-end-${agent.id}`, severity: "high", category: "agent", title: `No terminal node: "${agent.name}"`, detail: "No terminal node found. The call may loop indefinitely or not terminate cleanly.", fixable: true, fixHref: "/systemmind/workflows" });
        }
        // Fully disconnected nodes
        for (const n of nodes) {
          if ((inDeg.get(n.id) ?? 0) === 0 && (outDeg.get(n.id) ?? 0) === 0 && nodes.length > 1) {
            issues.push({ id: `wf-orphan-${agent.id}-${n.id}`, severity: "medium", category: "agent", title: `Orphan node in "${agent.name}"`, detail: `Node "${n.id}" (type: ${n.type ?? "unknown"}) is disconnected — unreachable and never executes.`, fixable: true, fixHref: "/systemmind/workflows" });
          }
        }
        // Webhook nodes missing URL
        for (const n of nodes) {
          const nd = n.data ?? {};
          if ((String(n.type ?? "").toLowerCase().includes("webhook") || nd.webhookUrl !== undefined) && !nd.webhookUrl && !nd.webhook_url) {
            issues.push({ id: `wf-webhook-nourl-${agent.id}-${n.id}`, severity: "high", category: "agent", title: `Webhook missing URL in "${agent.name}"`, detail: `Webhook node "${n.id}" has no URL. The call will fail silently on that branch.`, fixable: true, fixHref: "/systemmind/workflows" });
          }
        }
      }
    }
  } catch { /* graceful — agents table or flow_data may be missing */ }

  // Provider usage error rate check
  try {
    const usage = await getProviderUsage(workspaceId);
    for (const row of usage) {
      const rate = row.requests > 0 ? (row.errors / row.requests) * 100 : 0;
      if (rate > 15) {
        issues.push({ id: `err-rate-${row.provider_name}`, severity: "high", category: "reliability", title: `High error rate: ${row.provider_name} (${rate.toFixed(0)}%)`, detail: `${row.errors} errors across ${row.requests} requests in the ${row.provider_category} category.`, fixable: false, fixHref: "/systemmind/providers" });
      } else if (rate > 5) {
        issues.push({ id: `err-rate-warn-${row.provider_name}`, severity: "medium", category: "reliability", title: `Elevated error rate: ${row.provider_name} (${rate.toFixed(0)}%)`, detail: `${row.errors} errors across ${row.requests} requests.`, fixable: false, fixHref: "/systemmind/providers" });
      }
    }
  } catch { /* graceful */ }

  // Knowledge base check
  try {
    const { data: kbs } = await sb.from("executive_knowledge_bases").select("id, name").eq("workspace_id", workspaceId);
    if (kbs && kbs.length > 0) {
      for (const kb of kbs) {
        const { count } = await sb.from("executive_documents").select("id", { count: "exact", head: true }).eq("kb_id", kb.id);
        if ((count ?? 0) === 0) {
          issues.push({ id: `kb-empty-${kb.id}`, severity: "low", category: "knowledge", title: `Knowledge base "${kb.name}" is empty`, detail: `No documents uploaded. The AI executive backed by this KB has no grounded knowledge.`, fixable: true, fixHref: "/knowledge-centre" });
        }
      }
    }
  } catch { /* graceful — tables may not exist */ }

  const ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
  return issues.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

// ── 2. Providers ──────────────────────────────────────────────────────────────
const KNOWN_PROVIDERS: Array<{
  id: string; name: string; displayName: string;
  category: SystemMindProvider["category"]; configHint: string;
  fallback: string | null;
  keyCheck: (s: any) => "connected" | "disconnected" | "partial";
}> = [
  { id: "openai",     name: "openai",     displayName: "OpenAI",          category: "ai",        fallback: null,         configHint: "Settings → Integrations → OpenAI API Key",       keyCheck: (s) => (s.openai_api_key || process.env.OPENAI_API_KEY) ? "connected" : "disconnected" },
  { id: "retell",     name: "retell",     displayName: "Retell AI",        category: "voice",     fallback: null,         configHint: "Settings → Integrations → Retell",               keyCheck: (s) => (s.retell_workspace_id || process.env.RETELL_API_KEY) ? "connected" : "disconnected" },
  { id: "elevenlabs", name: "elevenlabs", displayName: "ElevenLabs",       category: "voice",     fallback: "Retell TTS", configHint: "Settings → Integrations → ElevenLabs API Key",   keyCheck: (s) => s.elevenlabs_api_key ? "connected" : "disconnected" },
  { id: "twilio",     name: "twilio",     displayName: "Twilio",           category: "telephony", fallback: null,         configHint: "Settings → Integrations → Twilio",               keyCheck: (s) => (s.twilio_auth_token && s.twilio_account_sid) ? "connected" : (!s.twilio_auth_token && !s.twilio_account_sid ? "disconnected" : "partial") },
  { id: "whatsapp",   name: "whatsapp",   displayName: "WhatsApp (Meta)",  category: "messaging", fallback: null,         configHint: "Settings → Integrations → WhatsApp",             keyCheck: (s) => s.whatsapp_phone_id ? "connected" : "disconnected" },
  { id: "wati",       name: "wati",       displayName: "WATI (WhatsApp)",  category: "messaging", fallback: "WhatsApp",   configHint: "Settings → Integrations → WATI",                 keyCheck: (s) => s.wati_api_key ? "connected" : "disconnected" },
  { id: "hubspot",    name: "hubspot",    displayName: "HubSpot CRM",      category: "crm",       fallback: null,         configHint: "Settings → Integrations → HubSpot",              keyCheck: (s) => s.hubspot_api_key ? "connected" : "disconnected" },
  { id: "ghl",        name: "ghl",        displayName: "GoHighLevel",      category: "crm",       fallback: null,         configHint: "Settings → Integrations → GoHighLevel",          keyCheck: (s) => s.ghl_api_key ? "connected" : "disconnected" },
  { id: "stripe",     name: "stripe",     displayName: "Stripe",           category: "payment",   fallback: null,         configHint: "Settings → Integrations → Stripe",               keyCheck: (s) => (s.stripe_secret_key || process.env.STRIPE_SECRET_KEY) ? "connected" : "disconnected" },
  { id: "calcom",     name: "calcom",     displayName: "Cal.com",          category: "calendar",  fallback: null,         configHint: "Settings → Integrations → Cal.com API Key",      keyCheck: (s) => s.calcom_api_key ? "connected" : "disconnected" },
  { id: "resend",     name: "resend",     displayName: "Resend (email)",   category: "email",     fallback: null,         configHint: "Env: RESEND_API_KEY",                             keyCheck: (_s) => process.env.RESEND_API_KEY ? "connected" : "disconnected" },
];

export async function getSystemMindProvidersServer(workspaceId: string): Promise<SystemMindProvider[]> {
  const sb = supabaseAdmin as any;
  const { data: ws } = await sb.from("workspace_settings").select("*").eq("workspace_id", workspaceId).maybeSingle();
  const s = ws ?? {};
  const usage = await getProviderUsage(workspaceId);
  const usageMap = new Map(usage.map((r) => [r.provider_name.toLowerCase(), r]));
  const checkedAt = new Date().toISOString();

  return KNOWN_PROVIDERS.map((p) => {
    const u = usageMap.get(p.name.toLowerCase());
    const requests = Number(u?.requests ?? 0);
    const errors = Number(u?.errors ?? 0);
    const status = p.keyCheck(s);
    return {
      id: p.id, name: p.name, displayName: p.displayName, category: p.category,
      status, keyPresent: status !== "disconnected",
      lastChecked: checkedAt, fallback: p.fallback,
      cost: Number(Number(u?.total_cost_usd ?? 0).toFixed(2)),
      requests, errors, errorCount: errors,
      errorRate: requests > 0 ? +((errors / requests) * 100).toFixed(1) : 0,
      lastUsedAt: u?.last_used_at ?? null, configHint: p.configHint,
    };
  });
}

// ── 3. Recommendations ────────────────────────────────────────────────────────
export async function listSystemMindRecommendationsServer(workspaceId: string) {
  const sb = supabaseAdmin as any;
  const { data } = await sb.from("systemmind_recommendations").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(50);
  return data ?? [];
}

export async function generateSystemMindRecommendationsServer(workspaceId: string, apiKey: string) {
  const sb = supabaseAdmin as any;
  const { computeSystemMindData } = await import("./systemmind.functions");
  const platformData = await computeSystemMindData(workspaceId);
  const issues = await getSystemMindIssuesServer(workspaceId);
  const providers = await getSystemMindProvidersServer(workspaceId);
  const connected = providers.filter((p) => p.status === "connected").length;
  const { data: agentCount } = await sb.from("agents").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);

  const context = `Platform telemetry:
- Agents: ${(agentCount as any)?.count ?? 0}
- Connected providers: ${connected}/${providers.length}
- Open issues: ${issues.length} (critical: ${issues.filter((i) => i.severity === "critical").length}, high: ${issues.filter((i) => i.severity === "high").length})
- Error rate: ${platformData.usage.errorRate}%
- Runtime cost: $${platformData.usage.totalCostUsd}
- Issues: ${issues.slice(0, 8).map((i) => `[${i.severity}] ${i.title}`).join("; ")}`;

  type Rec = { category: string; title: string; detail: string; priority: string };
  const result = await gptJson<{ recommendations: Rec[] }>(
    apiKey,
    "You are a CTO AI. Return ONLY valid JSON.",
    `Given this platform state, generate 5-8 actionable technical recommendations for a CTO.\n\n${context}\n\nReturn:\n{"recommendations":[{"category":"string","title":"string","detail":"string","priority":"critical|high|medium|low"}]}`,
    1400,
  );

  const recs = result?.recommendations ?? [];
  if (recs.length === 0) return [];

  // Clear old AI recommendations older than 7 days
  await sb.from("systemmind_recommendations").delete().eq("workspace_id", workspaceId).eq("source", "ai").lt("created_at", new Date(Date.now() - 7 * 86400_000).toISOString());

  const rows = recs.map((r: Rec) => ({
    workspace_id: workspaceId,
    category: String(r.category ?? "general").slice(0, 60),
    title: String(r.title ?? "").slice(0, 200),
    body: String(r.detail ?? "").slice(0, 800),
    priority: ["critical", "high", "medium", "low"].includes(r.priority) ? r.priority : "medium",
    source: "ai",
  }));
  await sb.from("systemmind_recommendations").insert(rows);
  const { data } = await sb.from("systemmind_recommendations").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(50);
  return data ?? [];
}

export async function dismissSystemMindRecommendationServer(workspaceId: string, id: string) {
  const sb = supabaseAdmin as any;
  await sb.from("systemmind_recommendations").update({ dismissed_at: new Date().toISOString() }).eq("id", id).eq("workspace_id", workspaceId);
}

// ── 4. Audits ─────────────────────────────────────────────────────────────────
export async function listSystemMindAuditsServer(workspaceId: string) {
  const sb = supabaseAdmin as any;
  const { data } = await sb.from("systemmind_audits").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(20);
  return data ?? [];
}

export async function runSystemMindAuditServer(workspaceId: string, apiKey: string): Promise<string> {
  const sb = supabaseAdmin as any;
  const { data: auditRow } = await sb.from("systemmind_audits").insert({ workspace_id: workspaceId, status: "running", triggered_by: "manual" }).select("id").single();
  const auditId = auditRow?.id as string;

  try {
    const { computeSystemMindData } = await import("./systemmind.functions");
    const [platformData, issues, providers] = await Promise.all([
      computeSystemMindData(workspaceId),
      getSystemMindIssuesServer(workspaceId),
      getSystemMindProvidersServer(workspaceId),
    ]);

    const context = `Platform snapshot:
Integrations: ${platformData.integrations.connected}/${platformData.integrations.total} connected
Agents: ${platformData.agents.total}
Error rate: ${platformData.usage.errorRate}% | Cost: $${platformData.usage.totalCostUsd} | Requests: ${platformData.usage.requests}
Providers: ${providers.map((p) => `${p.displayName}(${p.status})`).join(", ")}
Open issues (${issues.length}): ${issues.slice(0, 10).map((i) => `[${i.severity}] ${i.title}`).join("; ")}`;

    type Finding = { area: string; severity: string; finding: string; recommendation: string };
    const result = await gptJson<{ score: number; summary: string; findings: Finding[] }>(
      apiKey,
      "You are a CTO AI auditor. Return ONLY valid JSON.",
      `Audit this platform and return a technical health report.\n\n${context}\n\nReturn:\n{"score":0-100,"summary":"string","findings":[{"area":"string","severity":"critical|high|medium|low|info","finding":"string","recommendation":"string"}]}`,
      1600,
    );

    const score = typeof result?.score === "number" ? Math.min(100, Math.max(0, result.score)) : null;
    await sb.from("systemmind_audits").update({
      status: "complete", score,
      summary: { text: result?.summary ?? "", score },
      findings: result?.findings ?? [],
      completed_at: new Date().toISOString(),
    }).eq("id", auditId);
  } catch (err: any) {
    await sb.from("systemmind_audits").update({
      status: "failed",
      summary: { text: err?.message ?? "Audit failed." },
      completed_at: new Date().toISOString(),
    }).eq("id", auditId);
  }
  return auditId;
}

// ── 5. Fix Plans ──────────────────────────────────────────────────────────────
export async function listSystemMindFixPlansServer(workspaceId: string) {
  const sb = supabaseAdmin as any;
  const { data } = await sb.from("systemmind_fix_plans").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(50);
  return data ?? [];
}

export async function generateSystemMindFixPlanServer(
  workspaceId: string,
  opts: { title: string; detail: string; sourceType?: string; sourceId?: string },
  apiKey: string,
) {
  const sb = supabaseAdmin as any;
  type Step = { idx: number; title: string; detail: string; done: boolean };
  const result = await gptJson<{ steps: Array<{ title: string; detail: string }> }>(
    apiKey,
    "You are a CTO AI. Return ONLY valid JSON.",
    `Generate a step-by-step fix plan for the following technical problem.\n\nProblem: ${opts.title}\nContext: ${opts.detail}\n\nReturn: {"steps":[{"title":"string","detail":"string"}]}\n\nMax 8 steps. Be specific and actionable.`,
    900,
  );

  const steps: Step[] = (result?.steps ?? []).map((s, i) => ({ idx: i, title: String(s.title ?? "").slice(0, 200), detail: String(s.detail ?? "").slice(0, 500), done: false }));

  const { data } = await sb.from("systemmind_fix_plans").insert({
    workspace_id: workspaceId, title: opts.title.slice(0, 200), detail: opts.detail.slice(0, 800),
    source_type: opts.sourceType ?? "manual", source_id: opts.sourceId ?? null, steps, status: "open",
  }).select("*").single();
  return data;
}

export async function updateFixPlanStepServer(workspaceId: string, planId: string, stepIdx: number, done: boolean) {
  const sb = supabaseAdmin as any;
  const { data: plan } = await sb.from("systemmind_fix_plans").select("steps, status").eq("id", planId).eq("workspace_id", workspaceId).maybeSingle();
  if (!plan) throw new Error("Plan not found");
  const steps: any[] = (plan.steps ?? []).map((s: any) => s.idx === stepIdx ? { ...s, done } : s);
  const allDone = steps.length > 0 && steps.every((s) => s.done);
  const anyDone = steps.some((s) => s.done);
  const status = allDone ? "done" : anyDone ? "in_progress" : "open";
  await sb.from("systemmind_fix_plans").update({ steps, status, updated_at: new Date().toISOString() }).eq("id", planId).eq("workspace_id", workspaceId);
}

// ── 6. Tasks ──────────────────────────────────────────────────────────────────
export async function listSystemMindTasksServer(workspaceId: string) {
  const sb = supabaseAdmin as any;
  const { data } = await sb.from("systemmind_tasks").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false });
  return data ?? [];
}

export async function createSystemMindTaskServer(workspaceId: string, task: { title: string; description?: string; priority?: string; status?: string; due_at?: string | null; tags?: string[] }) {
  const sb = supabaseAdmin as any;
  const { data } = await sb.from("systemmind_tasks").insert({
    workspace_id: workspaceId,
    title: task.title.slice(0, 200),
    description: task.description?.slice(0, 800) ?? null,
    priority: task.priority ?? "medium",
    status: task.status ?? "open",
    due_at: task.due_at ?? null,
    tags: task.tags ?? [],
  }).select("*").single();
  return data;
}

export async function updateSystemMindTaskServer(workspaceId: string, id: string, patch: { title?: string; description?: string; priority?: string; status?: string; due_at?: string | null; tags?: string[] }) {
  const sb = supabaseAdmin as any;
  await sb.from("systemmind_tasks").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).eq("workspace_id", workspaceId);
}

export async function deleteSystemMindTaskServer(workspaceId: string, id: string) {
  const sb = supabaseAdmin as any;
  await sb.from("systemmind_tasks").delete().eq("id", id).eq("workspace_id", workspaceId);
}

// ── 7. Reports ────────────────────────────────────────────────────────────────
export async function listSystemMindReportsServer(workspaceId: string) {
  const sb = supabaseAdmin as any;
  const { data } = await sb.from("systemmind_reports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(20);
  return data ?? [];
}

export async function getSystemMindReportServer(workspaceId: string, id: string) {
  const sb = supabaseAdmin as any;
  const { data } = await sb.from("systemmind_reports").select("*").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
  return data;
}

export async function generateSystemMindReportServer(workspaceId: string, apiKey: string) {
  const sb = supabaseAdmin as any;
  const { computeSystemMindData } = await import("./systemmind.functions");
  const [platformData, issues, providers] = await Promise.all([
    computeSystemMindData(workspaceId),
    getSystemMindIssuesServer(workspaceId),
    getSystemMindProvidersServer(workspaceId),
  ]);
  const { data: taskStats } = await sb.from("systemmind_tasks").select("status").eq("workspace_id", workspaceId);
  const { count: openRecsCount } = await sb.from("systemmind_recommendations").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).is("dismissed_at", null);

  const openTasks = (taskStats ?? []).filter((t: any) => t.status === "open").length;
  const inProgressTasks = (taskStats ?? []).filter((t: any) => t.status === "in_progress").length;

  const context = `CTO Weekly Technical Report Data:
Date: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}

Platform Health:
- Reliability score: ${platformData.usage.errorRate < 5 ? "Good" : "Needs attention"}
- Integrations: ${platformData.integrations.connected}/${platformData.integrations.total} connected
- Agents deployed: ${platformData.agents.total}
- Error rate: ${platformData.usage.errorRate}%
- Runtime cost: $${platformData.usage.totalCostUsd}
- Total API requests: ${platformData.usage.requests}

Open Issues (${issues.length}):
${issues.slice(0, 8).map((i) => `- [${i.severity.toUpperCase()}] ${i.title}`).join("\n")}

Providers:
${providers.map((p) => `- ${p.displayName}: ${p.status}, ${p.requests} requests, ${p.errorRate}% errors`).join("\n")}

Task Board: ${openTasks} open, ${inProgressTasks} in-progress
Open Recommendations: ${openRecsCount ?? 0}`;

  const title = `CTO Weekly Report — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  const body = await gpt(
    apiKey,
    "You are a CTO AI. Write clear, professional technical reports in Markdown.",
    `Write a complete CTO weekly technical report based on this data. Include: Executive Summary, Platform Health, Key Issues & Risks, Provider Status, Actions Required, and Upcoming Focus. Be specific with numbers.\n\n${context}`,
    2000,
  );

  const { data } = await sb.from("systemmind_reports").insert({
    workspace_id: workspaceId, title, body, model: "gpt-4o-mini",
  }).select("*").single();
  return data;
}

// ── 8. Architecture ───────────────────────────────────────────────────────────
// Returns exactly 8 layers named: Database, Runtime, Telephony, Providers,
// Builder, CRM, GrowthMind, HiveMind — matching the required architecture taxonomy.
export async function getArchitectureLayersServer(workspaceId: string): Promise<ArchitectureLayer[]> {
  const sb = supabaseAdmin as any;
  const { data: ws } = await sb.from("workspace_settings").select("*").eq("workspace_id", workspaceId).maybeSingle();
  const s = ws ?? {};

  // Live status flags derived from workspace settings
  const hasOpenAI  = !!(s.openai_api_key || process.env.OPENAI_API_KEY);
  const hasRetell  = !!(s.retell_workspace_id || process.env.RETELL_API_KEY);
  const hasEL      = !!s.elevenlabs_api_key;
  const hasTwilio  = !!(s.twilio_auth_token && s.twilio_account_sid);
  const hasWA      = !!s.whatsapp_phone_id;
  const hasWATI    = !!s.wati_api_key;
  const hasCal     = !!s.calcom_api_key;
  const hasHubSpot = !!s.hubspot_api_key;
  const hasGHL     = !!s.ghl_api_key;
  const hasResend  = !!process.env.RESEND_API_KEY;
  const hasStripe  = !!(s.stripe_secret_key || process.env.STRIPE_SECRET_KEY);

  // AI-enriched descriptions — cached 24 h in workspace_settings
  let enriched: Record<string, string> = {};
  const apiKey = s.openai_api_key || process.env.OPENAI_API_KEY;
  if (apiKey) {
    const cacheKey = "systemmind_arch_descriptions";
    const cached = s[cacheKey];
    const cacheAge = cached?.ts ? Date.now() - new Date(cached.ts).getTime() : Infinity;
    if (cached?.data && cacheAge < 24 * 60 * 60 * 1000) {
      enriched = cached.data;
    } else {
      try {
        const active = [
          hasOpenAI && "OpenAI", hasRetell && "Retell", hasEL && "ElevenLabs",
          hasTwilio && "Twilio", hasWA && "WhatsApp", hasWATI && "WATI",
          hasCal && "Cal.com", hasHubSpot && "HubSpot", hasGHL && "GoHighLevel",
          hasResend && "Resend", hasStripe && "Stripe",
        ].filter(Boolean).join(", ") || "none";
        const raw = await gpt(
          apiKey,
          "You are a CTO AI. Return a JSON object mapping layer IDs to one-sentence descriptions (≤25 words) that reflect which services are active. Technical and specific.",
          `Active services: ${active}\n\nLayer IDs: database, runtime, telephony, providers, builder, crm, growthmind, hivemind\n\nReturn JSON only: {"database":"...","runtime":"...","telephony":"...","providers":"...","builder":"...","crm":"...","growthmind":"...","hivemind":"..."}`,
          700,
        );
        const parsed = JSON.parse(raw.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim());
        enriched = typeof parsed === "object" && parsed !== null ? parsed : {};
        await sb.from("workspace_settings")
          .update({ [cacheKey]: { ts: new Date().toISOString(), data: enriched } })
          .eq("workspace_id", workspaceId);
      } catch { /* fall back to static */ }
    }
  }

  function d(id: string, fallback: string): string {
    return (enriched as any)[id] || fallback;
  }

  return [
    {
      id: "database", order: 1, name: "Database", role: "Persistence & vector search",
      description: d("database", "Supabase PostgreSQL with pgvector for semantic search. Stores all agents, conversations, usage telemetry, campaigns, and executive knowledge bases."),
      components: [
        { name: "Supabase PostgreSQL", status: "active" },
        { name: "pgvector (1536-dim)", status: hasOpenAI ? "active" : "partial", note: hasOpenAI ? undefined : "Needs OpenAI key for embeddings" },
        { name: "Realtime subscriptions", status: "active" },
        { name: "Row-Level Security", status: "active" },
      ],
    },
    {
      id: "runtime", order: 2, name: "Runtime", role: "AI models, embeddings & automation engine",
      description: d("runtime", hasOpenAI
        ? "OpenAI GPT-4o active. text-embedding-3-small powers all KB RAG. Campaign executor + pg_cron automate scheduled operations."
        : "OpenAI key missing. AI executives, RAG embeddings, and content generation are unavailable."),
      components: [
        { name: "OpenAI GPT-4o", status: hasOpenAI ? "active" : "inactive", note: hasOpenAI ? undefined : "API key missing" },
        { name: "GPT-4o-mini", status: hasOpenAI ? "active" : "inactive" },
        { name: "text-embedding-3-small", status: hasOpenAI ? "active" : "inactive" },
        { name: "Campaign executor", status: "active" },
        { name: "pg_cron (prod)", status: "partial", note: "Verify in Supabase Dashboard" },
        { name: "HiveMind scanner", status: "active" },
      ],
    },
    {
      id: "telephony", order: 3, name: "Telephony", role: "Real-time voice agents & SIP",
      description: d("telephony", `Retell AI ${hasRetell ? "active" : "inactive"} for voice lifecycle. ElevenLabs HyperStream TTS ${hasEL ? "active" : "inactive"}. Twilio SIP ${hasTwilio ? "active" : "inactive"}.`),
      components: [
        { name: "Retell AI", status: hasRetell ? "active" : "inactive", note: hasRetell ? undefined : "Not configured" },
        { name: "ElevenLabs HyperStream", status: hasEL ? "active" : "inactive", note: hasEL ? undefined : "API key missing" },
        { name: "Twilio SIP / SMS", status: hasTwilio ? "active" : "inactive", note: hasTwilio ? undefined : "Credentials missing" },
        { name: "VoxStream relay", status: hasEL ? "active" : "inactive" },
      ],
    },
    {
      id: "providers", order: 4, name: "Providers", role: "External service integrations",
      description: d("providers", `Messaging via WhatsApp${hasWATI ? " + WATI" : ""}${hasResend ? " + Resend" : ""}. Payments via Stripe${hasStripe ? "" : " (not connected)"}.`),
      components: [
        { name: "WhatsApp (Meta)", status: hasWA ? "active" : "inactive", note: hasWA ? undefined : "Phone ID missing" },
        { name: "WATI", status: hasWATI ? "active" : "inactive", note: hasWATI ? undefined : "API key missing" },
        { name: "Resend (email)", status: hasResend ? "active" : "inactive", note: hasResend ? undefined : "RESEND_API_KEY missing" },
        { name: "Stripe", status: hasStripe ? "active" : "inactive", note: hasStripe ? undefined : "Secret key missing" },
      ],
    },
    {
      id: "builder", order: 5, name: "Builder", role: "Visual flow design & agent deployment",
      description: d("builder", "React Flow drag-and-drop builder. Agents defined as flow graphs and deployed to Retell or ElevenLabs. Webhook engine handles event-driven branching."),
      components: [
        { name: "Flow Builder (React Flow)", status: "active" },
        { name: "Agent runtime (Retell)", status: hasRetell ? "active" : "inactive" },
        { name: "HyperStream relay (EL)", status: hasEL ? "active" : "inactive" },
        { name: "Webhook engine", status: "active" },
      ],
    },
    {
      id: "crm", order: 6, name: "CRM", role: "Customer relationship & calendar connectors",
      description: d("crm", `HubSpot ${hasHubSpot ? "connected" : "not connected"}. GoHighLevel ${hasGHL ? "connected" : "not connected"}. Cal.com scheduling ${hasCal ? "active" : "inactive"}.`),
      components: [
        { name: "HubSpot CRM", status: hasHubSpot ? "active" : "inactive", note: hasHubSpot ? undefined : "API key missing" },
        { name: "GoHighLevel", status: hasGHL ? "active" : "inactive", note: hasGHL ? undefined : "API key missing" },
        { name: "Cal.com", status: hasCal ? "active" : "inactive", note: hasCal ? undefined : "API key missing" },
      ],
    },
    {
      id: "growthmind", order: 7, name: "GrowthMind", role: "AI Chief Marketing Officer module",
      description: d("growthmind", "GrowthMind CMO drives content calendar, growth scheduling, and marketing task generation grounded in the executive knowledge base."),
      components: [
        { name: "GrowthMind AI (CMO)", status: hasOpenAI ? "active" : "inactive", note: hasOpenAI ? undefined : "Requires OpenAI key" },
        { name: "Content Calendar", status: "active" },
        { name: "Growth Scheduler", status: "active" },
        { name: "GrowthMind KB (RAG)", status: hasOpenAI ? "active" : "inactive" },
      ],
    },
    {
      id: "hivemind", order: 8, name: "HiveMind", role: "AI Chief Operating Officer module",
      description: d("hivemind", "HiveMind COO observes, recommends, and coordinates all executives. Runs the HiveMind scanner and surfaces cross-platform findings."),
      components: [
        { name: "HiveMind AI (COO)", status: "active" },
        { name: "Executive council", status: hasOpenAI ? "active" : "inactive" },
        { name: "HiveMind scanner", status: "active" },
        { name: "HiveMind KB (RAG)", status: hasOpenAI ? "active" : "inactive" },
      ],
    },
  ];
}

// Singular layer lookup — returns just the requested layer by id.
export async function getArchitectureLayerServer(workspaceId: string, layerId: string): Promise<ArchitectureLayer | null> {
  const all = await getArchitectureLayersServer(workspaceId);
  return all.find((l) => l.id === layerId) ?? null;
}

// ── 9. CTO Settings ───────────────────────────────────────────────────────────
const DEFAULT_PROVIDERS_PRIORITY = ["openai", "retell", "elevenlabs", "twilio", "whatsapp", "wati", "hubspot", "ghl", "stripe", "calcom", "resend"];

const DEFAULT_SETTINGS: SystemMindCTOSettings = {
  persona: "professional",
  morningBriefing: false,
  autoScanInterval: "off",
  errorRateThreshold: 5,
  costDailyThreshold: 50,
  defaultAiModel: "gpt-4o-mini",
  notificationsEnabled: true,
  providerPriority: DEFAULT_PROVIDERS_PRIORITY,
};

export async function getSystemMindCTOSettingsServer(workspaceId: string): Promise<SystemMindCTOSettings> {
  const sb = supabaseAdmin as any;
  const { data } = await sb.from("workspace_settings").select("systemmind_cto_settings").eq("workspace_id", workspaceId).maybeSingle();
  const saved = data?.systemmind_cto_settings ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    providerPriority: saved.providerPriority?.length ? saved.providerPriority : DEFAULT_PROVIDERS_PRIORITY,
  };
}

export async function saveSystemMindCTOSettingsServer(workspaceId: string, settings: Partial<SystemMindCTOSettings>) {
  const sb = supabaseAdmin as any;
  await sb.from("workspace_settings").upsert({ workspace_id: workspaceId, systemmind_cto_settings: { ...DEFAULT_SETTINGS, ...settings } }, { onConflict: "workspace_id" });
}
