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
  fixHref?: string;
};

export type SystemMindProvider = {
  id: string;
  name: string;
  category: "ai" | "voice" | "telephony" | "crm" | "calendar" | "messaging" | "email" | "payment";
  displayName: string;
  status: "connected" | "disconnected" | "partial";
  cost: number;
  requests: number;
  errors: number;
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
};

// ── 1. Issues ─────────────────────────────────────────────────────────────────
export async function getSystemMindIssuesServer(workspaceId: string): Promise<SystemMindIssue[]> {
  const sb = supabaseAdmin as any;
  const { data: ws } = await sb.from("workspace_settings").select("*").eq("workspace_id", workspaceId).maybeSingle();
  const s = ws ?? {};
  const issues: SystemMindIssue[] = [];

  // Provider key checks
  if (!s.openai_api_key && !process.env.OPENAI_API_KEY) {
    issues.push({ id: "no-openai", severity: "critical", category: "provider", title: "OpenAI API key missing", detail: "No OpenAI key is configured. AI executives, embeddings, and all LLM features will not work.", fixHref: "/settings" });
  }
  if (!s.retell_workspace_id && !s.retell_default_agent_id && !process.env.RETELL_API_KEY) {
    issues.push({ id: "no-retell", severity: "high", category: "provider", title: "Retell not configured", detail: "No Retell workspace ID or API key. Voice agents cannot be deployed.", fixHref: "/settings" });
  }
  if (!s.elevenlabs_api_key) {
    issues.push({ id: "no-elevenlabs", severity: "medium", category: "provider", title: "ElevenLabs not connected", detail: "ElevenLabs API key is absent. Real-time voice (HyperStream) will fall back to Retell's default TTS.", fixHref: "/settings" });
  }
  if (!s.twilio_auth_token || !s.twilio_account_sid) {
    issues.push({ id: "no-twilio", severity: "medium", category: "telephony", title: "Twilio telephony not configured", detail: "Missing Twilio SID/Auth Token. Outbound calls and SMS cannot be placed through Twilio.", fixHref: "/settings" });
  }
  if (!s.calcom_api_key) {
    issues.push({ id: "no-calcom", severity: "low", category: "configuration", title: "Cal.com not connected", detail: "No Cal.com API key. Appointment-booking flows will be unable to create calendar events.", fixHref: "/settings" });
  }
  if (!s.whatsapp_phone_id) {
    issues.push({ id: "no-whatsapp", severity: "low", category: "configuration", title: "WhatsApp channel inactive", detail: "No WhatsApp Phone ID configured. WhatsApp messaging agents will not receive or send messages.", fixHref: "/settings" });
  }

  // Agent workflow issues
  try {
    const { data: wfRows } = await sb.from("systemmind_workflow_library").select("workflow_name, node_count, edge_count, category, agent_id").eq("workspace_id", workspaceId);
    if (wfRows) {
      for (const wf of wfRows) {
        const nc = Number(wf.node_count ?? 0);
        const ec = Number(wf.edge_count ?? 0);
        if (nc === 0) {
          issues.push({ id: `wf-empty-${wf.agent_id}`, severity: "high", category: "agent", title: `Empty flow: "${wf.workflow_name}"`, detail: `Agent has no flow nodes. It cannot handle any conversation.`, fixHref: "/systemmind/workflows" });
        } else if (nc > 1 && ec === 0) {
          issues.push({ id: `wf-disconnected-${wf.agent_id}`, severity: "high", category: "agent", title: `Disconnected flow: "${wf.workflow_name}"`, detail: `Agent has ${nc} nodes but no edges connecting them. The flow will stall after the first node.`, fixHref: "/systemmind/workflows" });
        }
      }
    }
  } catch { /* workflow library may not be populated */ }

  // Provider usage error rate check
  try {
    const usage = await getProviderUsage(workspaceId);
    for (const row of usage) {
      const rate = row.requests > 0 ? (row.errors / row.requests) * 100 : 0;
      if (rate > 15) {
        issues.push({ id: `err-rate-${row.provider_name}`, severity: "high", category: "reliability", title: `High error rate: ${row.provider_name} (${rate.toFixed(0)}%)`, detail: `${row.errors} errors across ${row.requests} requests in the ${row.provider_category} category.`, fixHref: "/systemmind/providers" });
      } else if (rate > 5) {
        issues.push({ id: `err-rate-warn-${row.provider_name}`, severity: "medium", category: "reliability", title: `Elevated error rate: ${row.provider_name} (${rate.toFixed(0)}%)`, detail: `${row.errors} errors across ${row.requests} requests.`, fixHref: "/systemmind/providers" });
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
          issues.push({ id: `kb-empty-${kb.id}`, severity: "low", category: "knowledge", title: `Knowledge base "${kb.name}" is empty`, detail: `No documents uploaded. The AI executive backed by this KB has no grounded knowledge.`, fixHref: "/knowledge-centre" });
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
  keyCheck: (s: any) => "connected" | "disconnected" | "partial";
}> = [
  { id: "openai",      name: "openai",      displayName: "OpenAI",         category: "ai",        configHint: "Settings → Integrations → OpenAI API Key",       keyCheck: (s) => (s.openai_api_key || process.env.OPENAI_API_KEY) ? "connected" : "disconnected" },
  { id: "retell",      name: "retell",      displayName: "Retell AI",       category: "voice",     configHint: "Settings → Integrations → Retell",               keyCheck: (s) => (s.retell_workspace_id || process.env.RETELL_API_KEY) ? "connected" : "disconnected" },
  { id: "elevenlabs",  name: "elevenlabs",  displayName: "ElevenLabs",      category: "voice",     configHint: "Settings → Integrations → ElevenLabs API Key",   keyCheck: (s) => s.elevenlabs_api_key ? "connected" : "disconnected" },
  { id: "twilio",      name: "twilio",      displayName: "Twilio",          category: "telephony", configHint: "Settings → Integrations → Twilio",               keyCheck: (s) => (s.twilio_auth_token && s.twilio_account_sid) ? "connected" : (!s.twilio_auth_token && !s.twilio_account_sid ? "disconnected" : "partial") },
  { id: "whatsapp",    name: "whatsapp",    displayName: "WhatsApp",        category: "messaging", configHint: "Settings → Integrations → WhatsApp",             keyCheck: (s) => s.whatsapp_phone_id ? "connected" : "disconnected" },
  { id: "calcom",      name: "calcom",      displayName: "Cal.com",         category: "calendar",  configHint: "Settings → Integrations → Cal.com API Key",      keyCheck: (s) => s.calcom_api_key ? "connected" : "disconnected" },
  { id: "resend",      name: "resend",      displayName: "Resend (email)",  category: "email",     configHint: "Env: RESEND_API_KEY",                             keyCheck: (_s) => process.env.RESEND_API_KEY ? "connected" : "disconnected" },
];

export async function getSystemMindProvidersServer(workspaceId: string): Promise<SystemMindProvider[]> {
  const sb = supabaseAdmin as any;
  const { data: ws } = await sb.from("workspace_settings").select("*").eq("workspace_id", workspaceId).maybeSingle();
  const s = ws ?? {};
  const usage = await getProviderUsage(workspaceId);
  const usageMap = new Map(usage.map((r) => [r.provider_name.toLowerCase(), r]));

  return KNOWN_PROVIDERS.map((p) => {
    const u = usageMap.get(p.name.toLowerCase());
    const requests = Number(u?.requests ?? 0);
    const errors = Number(u?.errors ?? 0);
    return {
      id: p.id, name: p.name, displayName: p.displayName, category: p.category,
      status: p.keyCheck(s), cost: Number(Number(u?.total_cost_usd ?? 0).toFixed(2)),
      requests, errors, errorRate: requests > 0 ? +((errors / requests) * 100).toFixed(1) : 0,
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
    detail: String(r.detail ?? "").slice(0, 800),
    priority: ["critical", "high", "medium", "low"].includes(r.priority) ? r.priority : "medium",
    status: "open", source: "ai",
  }));
  await sb.from("systemmind_recommendations").insert(rows);
  const { data } = await sb.from("systemmind_recommendations").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(50);
  return data ?? [];
}

export async function dismissSystemMindRecommendationServer(workspaceId: string, id: string) {
  const sb = supabaseAdmin as any;
  await sb.from("systemmind_recommendations").update({ status: "dismissed", dismissed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id).eq("workspace_id", workspaceId);
}

// ── 4. Audits ─────────────────────────────────────────────────────────────────
export async function listSystemMindAuditsServer(workspaceId: string) {
  const sb = supabaseAdmin as any;
  const { data } = await sb.from("systemmind_audits").select("*").eq("workspace_id", workspaceId).order("run_at", { ascending: false }).limit(20);
  return data ?? [];
}

export async function runSystemMindAuditServer(workspaceId: string, apiKey: string): Promise<string> {
  const sb = supabaseAdmin as any;
  const { data: auditRow } = await sb.from("systemmind_audits").insert({ workspace_id: workspaceId, status: "running" }).select("id").single();
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
      status: "complete", score, summary: result?.summary ?? "", findings: result?.findings ?? [],
      completed_at: new Date().toISOString(),
    }).eq("id", auditId);
  } catch (err: any) {
    await sb.from("systemmind_audits").update({ status: "failed", summary: err?.message ?? "Audit failed.", completed_at: new Date().toISOString() }).eq("id", auditId);
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

export async function createSystemMindTaskServer(workspaceId: string, task: { title: string; description?: string; priority?: string; status?: string; due_date?: string | null; tags?: string[] }) {
  const sb = supabaseAdmin as any;
  const { data } = await sb.from("systemmind_tasks").insert({ workspace_id: workspaceId, title: task.title.slice(0, 200), description: task.description?.slice(0, 800) ?? null, priority: task.priority ?? "medium", status: task.status ?? "open", due_date: task.due_date ?? null, tags: task.tags ?? [] }).select("*").single();
  return data;
}

export async function updateSystemMindTaskServer(workspaceId: string, id: string, patch: { title?: string; description?: string; priority?: string; status?: string; due_date?: string | null; tags?: string[] }) {
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
  const { data } = await sb.from("systemmind_reports").select("id, title, generated_at").eq("workspace_id", workspaceId).order("generated_at", { ascending: false }).limit(20);
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
  const { data: recsOpen } = await sb.from("systemmind_recommendations").select("id", { count: "exact" }).eq("workspace_id", workspaceId).eq("status", "open");

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
Open Recommendations: ${(recsOpen as any)?.length ?? 0}`;

  const title = `CTO Weekly Report — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  const content = await gpt(
    apiKey,
    "You are a CTO AI. Write clear, professional technical reports in Markdown.",
    `Write a complete CTO weekly technical report based on this data. Include: Executive Summary, Platform Health, Key Issues & Risks, Provider Status, Actions Required, and Upcoming Focus. Be specific with numbers.\n\n${context}`,
    2000,
  );

  const { data } = await sb.from("systemmind_reports").insert({ workspace_id: workspaceId, title, content, data_snapshot: { issues: issues.length, providers: providers.length, cost: platformData.usage.totalCostUsd } }).select("*").single();
  return data;
}

// ── 8. Architecture ───────────────────────────────────────────────────────────
export async function getArchitectureLayersServer(workspaceId: string): Promise<ArchitectureLayer[]> {
  const sb = supabaseAdmin as any;
  const { data: ws } = await sb.from("workspace_settings").select("*").eq("workspace_id", workspaceId).maybeSingle();
  const s = ws ?? {};
  const hasOpenAI = !!(s.openai_api_key || process.env.OPENAI_API_KEY);
  const hasRetell = !!(s.retell_workspace_id || process.env.RETELL_API_KEY);
  const hasEL = !!s.elevenlabs_api_key;
  const hasTwilio = !!(s.twilio_auth_token && s.twilio_account_sid);
  const hasWA = !!s.whatsapp_phone_id;
  const hasCal = !!s.calcom_api_key;
  const hasResend = !!process.env.RESEND_API_KEY;

  return [
    {
      id: "data", order: 1, name: "Data Layer", role: "Persistence & vector search",
      description: "Supabase PostgreSQL with pgvector for semantic search. Stores all agents, conversations, usage telemetry, campaign data, and executive knowledge bases.",
      components: [
        { name: "Supabase PostgreSQL", status: "active" },
        { name: "pgvector (1536-dim)", status: "active" },
        { name: "Realtime subscriptions", status: "active" },
        { name: "Row-Level Security", status: "active" },
      ],
    },
    {
      id: "ai-runtime", order: 2, name: "AI Runtime", role: "LLM, embeddings & reasoning",
      description: "OpenAI GPT-4o for executive reasoning and content generation. text-embedding-3-small for semantic vector indexing across all knowledge bases.",
      components: [
        { name: "GPT-4o", status: hasOpenAI ? "active" : "inactive", note: hasOpenAI ? undefined : "API key missing" },
        { name: "GPT-4o-mini", status: hasOpenAI ? "active" : "inactive" },
        { name: "text-embedding-3-small", status: hasOpenAI ? "active" : "inactive" },
      ],
    },
    {
      id: "voice", order: 3, name: "Voice & Telephony", role: "Real-time voice agents",
      description: "Retell AI manages the voice agent lifecycle and SIP routing. ElevenLabs provides HyperStream real-time TTS. Twilio handles outbound SIP and phone number management.",
      components: [
        { name: "Retell AI", status: hasRetell ? "active" : "inactive", note: hasRetell ? undefined : "Not configured" },
        { name: "ElevenLabs HyperStream", status: hasEL ? "active" : "inactive", note: hasEL ? undefined : "API key missing" },
        { name: "Twilio SIP / SMS", status: hasTwilio ? "active" : "inactive", note: hasTwilio ? undefined : "Credentials missing" },
        { name: "VoxStream relay", status: hasEL ? "active" : "inactive" },
      ],
    },
    {
      id: "messaging", order: 4, name: "Messaging Layer", role: "Async & WhatsApp channels",
      description: "WhatsApp Business API (Meta/WATI) for conversational automation. Resend for transactional emails. Supports multi-channel campaigns.",
      components: [
        { name: "WhatsApp (Meta/WATI)", status: hasWA ? "active" : "inactive", note: hasWA ? undefined : "Phone ID missing" },
        { name: "Resend (email)", status: hasResend ? "active" : "inactive", note: hasResend ? undefined : "API key missing" },
        { name: "Campaign executor", status: "active" },
      ],
    },
    {
      id: "integrations", order: 5, name: "CRM & Calendar", role: "External system connectors",
      description: "Cal.com for scheduling automation. HubSpot and GoHighLevel for CRM sync. Connectors are workspace-scoped and isolated per client.",
      components: [
        { name: "Cal.com", status: hasCal ? "active" : "inactive", note: hasCal ? undefined : "API key missing" },
        { name: "HubSpot CRM", status: "partial", note: "Connector-based" },
        { name: "GoHighLevel", status: "partial", note: "Connector-based" },
      ],
    },
    {
      id: "builder", order: 6, name: "Agent Builder", role: "Flow design & deployment",
      description: "Visual drag-and-drop flow builder with TanStack Start SSR. Agents are defined as flow graphs (nodes + edges) persisted in the agents table and deployed to Retell or ElevenLabs.",
      components: [
        { name: "Flow Builder (React Flow)", status: "active" },
        { name: "Agent runtime (Retell)", status: hasRetell ? "active" : "inactive" },
        { name: "HyperStream relay (EL)", status: hasEL ? "active" : "inactive" },
        { name: "Webhook engine", status: "active" },
      ],
    },
    {
      id: "executive-layer", order: 7, name: "Executive AI Layer", role: "Strategic intelligence modules",
      description: "Three AI executives share platform telemetry but are RAG-isolated per KB access rules. HiveMind (COO) coordinates all three. Each executive has its own knowledge base.",
      components: [
        { name: "HiveMind (COO)", status: "active" },
        { name: "GrowthMind (CMO)", status: hasOpenAI ? "active" : "inactive" },
        { name: "SystemMind (CTO)", status: "active" },
        { name: "Executive KB (pgvector RAG)", status: hasOpenAI ? "active" : "inactive" },
      ],
    },
    {
      id: "scheduler", order: 8, name: "Automation & Scheduler", role: "Campaign execution & cron",
      description: "Campaign executor ticks every 5 minutes in dev (Vite plugin) and is triggered by pg_cron in production via POST /api/public/campaign-executor. Handles follow-up sequences and scheduled messaging.",
      components: [
        { name: "Campaign executor", status: "active" },
        { name: "pg_cron (prod)", status: "partial", note: "Verify in Supabase Dashboard" },
        { name: "HiveMind scanner", status: "active" },
        { name: "Workflow validator", status: "active" },
      ],
    },
  ];
}

// ── 9. CTO Settings ───────────────────────────────────────────────────────────
const DEFAULT_SETTINGS: SystemMindCTOSettings = {
  persona: "professional",
  morningBriefing: false,
  autoScanInterval: "off",
  errorRateThreshold: 5,
  costDailyThreshold: 50,
};

export async function getSystemMindCTOSettingsServer(workspaceId: string): Promise<SystemMindCTOSettings> {
  const sb = supabaseAdmin as any;
  const { data } = await sb.from("workspace_settings").select("systemmind_cto_settings").eq("workspace_id", workspaceId).maybeSingle();
  return { ...DEFAULT_SETTINGS, ...(data?.systemmind_cto_settings ?? {}) };
}

export async function saveSystemMindCTOSettingsServer(workspaceId: string, settings: Partial<SystemMindCTOSettings>) {
  const sb = supabaseAdmin as any;
  await sb.from("workspace_settings").upsert({ workspace_id: workspaceId, systemmind_cto_settings: { ...DEFAULT_SETTINGS, ...settings } }, { onConflict: "workspace_id" });
}
