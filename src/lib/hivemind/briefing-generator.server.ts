// ── Executive Briefing Generator — server-only ────────────────────────────────
// Generates daily / weekly / monthly executive briefings from real platform data.
// Saves to hivemind_briefings table.
// Called by the daily scheduler and on-demand from /hivemind/briefings.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

type BriefingType = "daily" | "weekly" | "monthly";

async function gpt4o(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 2000,
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-4o", messages, max_tokens: maxTokens, temperature: 0.45 }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text().catch(() => "")).slice(0, 120)}`);
  const j = (await res.json()) as any;
  return (j.choices?.[0]?.message?.content as string) ?? "";
}

function parseJson(raw: string, fallback: any = {}): any {
  try {
    return JSON.parse(raw.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim());
  } catch { return fallback; }
}

// ── Pull workspace snapshot ────────────────────────────────────────────────────
async function pullSnapshot(workspaceId: string, dayRange: number) {
  const sb = supabaseAdmin as any;
  const since = new Date(Date.now() - dayRange * 86400000).toISOString();

  const [leadsRes, callsRes, campaignsRes, dnaRes, briefingsRes, opportunitiesRes] =
    await Promise.all([
      sb.from("leads").select("status, lead_source, created_at, updated_at")
        .eq("workspace_id", workspaceId),
      sb.from("calls").select("call_status, call_successful, duration_seconds, sentiment, created_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", since),
      sb.from("growthmind_campaign_drafts")
        .select("title, campaign_type, status, channels, performance_data, created_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", since),
      sb.from("growthmind_business_dna")
        .select("company_name, industry, services, unique_selling_points, main_growth_objective, revenue_goals, monthly_marketing_budget")
        .eq("workspace_id", workspaceId)
        .single(),
      sb.from("hivemind_briefings")
        .select("summary, meta")
        .eq("workspace_id", workspaceId)
        .eq("type", "daily")
        .order("created_at", { ascending: false })
        .limit(1),
      sb.from("growthmind_opportunities")
        .select("title, category, urgency, confidence_score, recommended_action")
        .eq("workspace_id", workspaceId)
        .order("confidence_score", { ascending: false })
        .limit(10),
    ]);

  const leads       = leadsRes.data ?? [];
  const calls       = callsRes.data ?? [];
  const campaigns   = campaignsRes.data ?? [];
  const dna         = dnaRes.data ?? {};
  const lastBriefing = briefingsRes.data?.[0] ?? null;
  const opps        = opportunitiesRes.data ?? [];

  // Compute key metrics
  const totalLeads    = leads.length;
  const newLeads      = leads.filter((l: any) => l.created_at >= since).length;
  const wonLeads      = leads.filter((l: any) => l.status === "sale_done").length;
  const convRate      = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0;
  const totalCalls    = calls.length;
  const successCalls  = calls.filter((c: any) => c.call_successful).length;
  const avgCallDurSec = calls.length
    ? Math.round(calls.reduce((s: number, c: any) => s + (c.duration_seconds ?? 0), 0) / calls.length)
    : 0;

  return {
    metrics: { totalLeads, newLeads, wonLeads, convRate, totalCalls, successCalls, avgCallDurSec },
    dna,
    campaigns,
    opps,
    lastBriefingSummary: lastBriefing?.summary ?? "",
  };
}

// ── Main generator ────────────────────────────────────────────────────────────
export async function generateBriefing(
  workspaceId: string,
  apiKey: string,
  type: BriefingType = "daily",
  generatedBy: "scheduler" | "manual" = "scheduler",
): Promise<{ briefingId: string; briefing: any }> {
  const sb = supabaseAdmin as any;
  const dayRange = type === "daily" ? 1 : type === "weekly" ? 7 : 30;
  const snap = await pullSnapshot(workspaceId, dayRange);

  const period = type === "daily" ? "today" : type === "weekly" ? "this week" : "this month";
  const prevPeriod = type === "daily" ? "yesterday" : type === "weekly" ? "last week" : "last month";

  const prompt = `You are an AI Chief Executive Officer providing a ${type} executive briefing to a business owner.

BUSINESS CONTEXT:
Company: ${snap.dna.company_name ?? "This workspace"}
Industry: ${snap.dna.industry ?? "Unknown"}
Services: ${(snap.dna.services ?? "").slice(0, 200)}
Main Goal: ${snap.dna.main_growth_objective ?? ""}

METRICS (${period}):
- New Leads: ${snap.metrics.newLeads} (total pipeline: ${snap.metrics.totalLeads})
- Calls Made: ${snap.metrics.totalCalls} (${snap.metrics.successCalls} successful)
- Conversion Rate: ${snap.metrics.convRate}%
- Avg Call Duration: ${Math.round(snap.metrics.avgCallDurSec / 60)} min

ACTIVE CAMPAIGNS: ${snap.campaigns.map((c: any) => `${c.campaign_type}: ${c.title}`).join(", ") || "None"}

TOP OPPORTUNITIES:
${snap.opps.map((o: any) => `- ${o.title} (${o.urgency} urgency, ${Math.round(o.confidence_score * 100)}% confidence)`).join("\n") || "None detected"}

PREVIOUS BRIEFING SUMMARY: ${snap.lastBriefingSummary.slice(0, 300) || "No previous briefing"}

Generate a ${type} executive briefing. Return ONLY valid JSON:
{
  "title": "string — compelling briefing title with date context",
  "summary": "string — 2-3 sentence executive summary (for notification preview)",
  "sections": {
    "executive_summary": "string — 3-5 sentence overview of the ${period}",
    "what_happened": "string — concrete factual report of activity ${period}",
    "what_changed": "string — what improved or declined vs ${prevPeriod}",
    "what_worked": "string — specific successes with data",
    "what_failed": "string — honest assessment of what underperformed",
    "next_actions": ["string — specific, actionable recommendation", "..."],
    "recommended_campaigns": [
      { "title": "string", "rationale": "string", "channel": "string", "urgency": "high|medium|low" }
    ],
    "key_metrics": {
      "new_leads": ${snap.metrics.newLeads},
      "calls_made": ${snap.metrics.totalCalls},
      "success_rate_pct": ${snap.metrics.totalCalls > 0 ? Math.round((snap.metrics.successCalls / snap.metrics.totalCalls) * 100) : 0},
      "conversion_rate_pct": ${snap.metrics.convRate},
      "pipeline_total": ${snap.metrics.totalLeads}
    }
  },
  "meta": {
    "period": "${type}",
    "leads_count": ${snap.metrics.totalLeads},
    "new_leads": ${snap.metrics.newLeads},
    "calls_count": ${snap.metrics.totalCalls},
    "highlights": ["string"]
  }
}

Be direct, honest, and data-driven. Avoid vague platitudes. Reference specific numbers.`;

  const raw = await gpt4o(
    apiKey,
    [
      { role: "system", content: "Executive AI briefing system. Return ONLY valid JSON." },
      { role: "user", content: prompt },
    ],
    2500,
  );

  const parsed = parseJson(raw, {
    title: `${type.charAt(0).toUpperCase() + type.slice(1)} Briefing — ${new Date().toLocaleDateString()}`,
    summary: "Executive briefing generated.",
    sections: { executive_summary: "No data available.", next_actions: [], recommended_campaigns: [], key_metrics: {} },
    meta: {},
  });

  const { data: row, error } = await sb
    .from("hivemind_briefings")
    .insert({
      workspace_id: workspaceId,
      type,
      title:        parsed.title,
      summary:      parsed.summary,
      sections:     parsed.sections ?? {},
      meta:         parsed.meta ?? {},
      is_read:      false,
      generated_by: generatedBy,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to save briefing: ${error.message}`);
  return { briefingId: row.id, briefing: parsed };
}

// ── Check if we already have a briefing of this type today ───────────────────
export async function hasTodaysBriefing(workspaceId: string, type: BriefingType): Promise<boolean> {
  const sb    = supabaseAdmin as any;
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const { data } = await sb
    .from("hivemind_briefings")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("type", type)
    .gte("created_at", since.toISOString())
    .limit(1);
  return (data?.length ?? 0) > 0;
}
