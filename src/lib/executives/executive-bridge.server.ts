// ── Executive Bridge — server-only builders ────────────────────────────────────
// SERVER ONLY. Never import this from a client component / .tsx file. It is loaded
// dynamically inside the createServerFn handlers in `executive-bridge.ts`.
//
// These are pure async builders (sb, workspaceId) → secret-free summary objects.
// They REUSE the existing GrowthMind engines and HiveMind aggregator — no new
// marketing analytics are computed here.

import { buildGrowthMindData } from "@/lib/growthmind/growthmind.functions";
import { computeGrowthScore } from "@/lib/growthmind/growthmind.score";
import { generateGrowthRecommendations, type GrowthRecommendation } from "@/lib/growthmind/growthmind.recommendations";
import { detectLeadOpportunities, getOpportunitySummary, type LeadOpportunity } from "@/lib/growthmind/growthmind.opportunities";
import { fetchFullPlatformData } from "@/lib/hivemind/hivemind.ai";
import { computeSystemMindData } from "@/lib/systemmind/systemmind.functions";
import { buildSystemMindSummary } from "@/lib/systemmind/systemmind.ai";
import {
  EXECUTIVE_COUNCIL,
  EXECUTIVE_TASK_TYPES,
  EXECUTIVE_TASK_LABELS,
  type ExecutiveTaskType,
  type ExecOpportunity,
  type ExecRisk,
  type ExecReadiness,
  type ExecRecommendedAction,
  type ExecMarketingReport,
  type RevenueOpportunity,
  type GrowthMindExecutiveSummary,
  type HiveMindExecutiveSummary,
  type SystemMindExecutiveSummary,
  type ExecutiveCouncilSummary,
  type ExecutiveEvent,
  type ExecSource,
} from "@/lib/executives/executive-council";

// ── Helpers ────────────────────────────────────────────────────────────────────

// Map a GrowthMind recommendation onto one of the six defined executive task types.
function inferExecutiveTaskType(rec: GrowthRecommendation): ExecutiveTaskType | null {
  const cat = (rec.category ?? "").toLowerCase();
  const id  = (rec.id ?? "").toLowerCase();

  if (cat.includes("seo") || id.includes("seo"))            return EXECUTIVE_TASK_TYPES.SEO_CAMPAIGN;
  if (cat.includes("content") || id.includes("content"))    return EXECUTIVE_TASK_TYPES.CONTENT_PLAN;
  if (cat.includes("strategy") || id.includes("competitor")) return EXECUTIVE_TASK_TYPES.COMPETITOR_REVIEW;
  if (id.includes("referral"))                              return EXECUTIVE_TASK_TYPES.REFERRAL_CAMPAIGN;
  if (cat.includes("nurture") || id.includes("followup") || id.includes("follow-up") || cat.includes("channel"))
    return EXECUTIVE_TASK_TYPES.FOLLOW_UP_CAMPAIGN;
  if (cat.includes("pipeline") || cat.includes("lead") || cat.includes("conversion") || cat.includes("funnel") || cat.includes("response"))
    return EXECUTIVE_TASK_TYPES.LEAD_NURTURE;
  return null; // e.g. call-campaign recs — handled by HiveMind ops, not a marketing task type
}

function priorityToSeverity(p: string): "critical" | "high" | "medium" | "low" {
  if (p === "critical") return "critical";
  if (p === "high")     return "high";
  if (p === "medium")   return "medium";
  return "low";
}

// ── GrowthMind (CMO) executive summary ─────────────────────────────────────────
export async function buildGrowthMindExecutiveSummary(
  sb: any,
  workspaceId: string,
): Promise<GrowthMindExecutiveSummary> {
  const data = await buildGrowthMindData(sb, workspaceId);

  // Reuse the existing engines — no recomputation of marketing metrics.
  const score = computeGrowthScore(data);
  const recs  = generateGrowthRecommendations(data);
  const opps  = detectLeadOpportunities(data);
  const oppSummary = getOpportunitySummary(data);

  // Recent marketing reports + latest forecast deal value (best-effort; tables may
  // not be migrated in every workspace).
  const [forecastsRes, funnelsRes, plansRes] = await Promise.all([
    Promise.resolve(
      sb.from("growthmind_forecasts")
        .select("id, scenario, deal_value, currency, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(5),
    ).catch(() => ({ data: [] })),
    Promise.resolve(
      sb.from("growthmind_funnels")
        .select("id, name, snapshot_at, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(5),
    ).catch(() => ({ data: [] })),
    Promise.resolve(
      sb.from("growthmind_growth_plans")
        .select("id, name, plan_type, generated_at, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(5),
    ).catch(() => ({ data: [] })),
  ]);

  const forecasts = (forecastsRes as any).data ?? [];
  const funnels   = (funnelsRes as any).data ?? [];
  const plans     = (plansRes as any).data ?? [];

  const recentMarketingReports: ExecMarketingReport[] = [
    ...forecasts.map((f: any) => ({
      id: String(f.id),
      type: "Revenue Forecast",
      title: `${(f.scenario ?? "base").replace(/^\w/, (c: string) => c.toUpperCase())} forecast`,
      date: f.created_at,
    })),
    ...funnels.map((f: any) => ({
      id: String(f.id),
      type: "Funnel Snapshot",
      title: f.name ?? "Funnel Snapshot",
      date: f.snapshot_at ?? f.created_at,
    })),
    ...plans.map((p: any) => ({
      id: String(p.id),
      type: "Growth Plan",
      title: p.name ?? "Growth Plan",
      date: p.generated_at ?? p.created_at,
    })),
  ]
    .filter((r) => !!r.date)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 6);

  // Readiness dimensions straight from the score engine.
  const readiness: ExecReadiness[] = score.dimensions.map((d) => ({
    key: d.key, label: d.label, score: d.score, max: d.max, pct: d.pct, note: d.note, color: d.color,
  }));

  // Top opportunities (already urgency-sorted by the engine).
  const topOpportunities: ExecOpportunity[] = opps.slice(0, 5).map((o: LeadOpportunity) => ({
    id: o.id,
    label: `${o.label}${o.name ? ` — ${o.name}` : ""}`,
    detail: o.reason,
    urgency: o.urgency,
  }));

  // Top risks from the critical/high recommendations.
  const topRisks: ExecRisk[] = recs
    .filter((r) => r.priority === "critical" || r.priority === "high")
    .slice(0, 4)
    .map((r) => ({
      id: r.id,
      title: r.problem,
      detail: r.impact,
      severity: priorityToSeverity(r.priority),
    }));

  // Recommended actions mapped onto the executive task types.
  const recommendedActions: ExecRecommendedAction[] = recs.slice(0, 6).map((r) => {
    const taskType = inferExecutiveTaskType(r);
    return {
      id: r.id,
      label: taskType ? EXECUTIVE_TASK_LABELS[taskType] : r.category,
      taskType,
      priority: priorityToSeverity(r.priority),
      problem: r.problem,
      fix: r.fix,
      actionHref: r.action?.href ?? null,
    };
  });

  // Missing marketing assets derived from systemHealth flags.
  const sh = (data as any).systemHealth ?? {};
  const missingMarketingAssets: string[] = [];
  if (!sh.campaigns)         missingMarketingAssets.push("No outreach campaigns");
  if (!sh.emailCampaigns)    missingMarketingAssets.push("No email follow-up campaigns");
  if (!sh.seoKeywords)       missingMarketingAssets.push("No SEO keywords tracked");
  if (!sh.recentContent)     missingMarketingAssets.push("No recent content published");
  if (!sh.competitors)       missingMarketingAssets.push("No competitor analysis");
  if (!sh.waOutreach)        missingMarketingAssets.push("No WhatsApp outreach");

  // Revenue opportunity — a simple, clearly-labelled estimate (no forecast internals).
  const bt = oppSummary.byType;
  const recoverableLeads = bt.stale + bt.never_called + bt.stalled + bt.no_show;
  const hotLeads         = bt.hot_lead;
  const latestDealValue  = Number(forecasts[0]?.deal_value ?? 0);
  const convRate         = Number((data as any).leads?.conversionRate ?? 0) / 100;
  const estimatedValue   =
    latestDealValue > 0 && recoverableLeads > 0
      ? Math.round(recoverableLeads * Math.max(convRate, 0.05) * latestDealValue)
      : null;

  const revenueOpportunity: RevenueOpportunity = {
    recoverableLeads,
    hotLeads,
    estimatedValue,
    note:
      estimatedValue != null
        ? `Estimate: re-engaging ${recoverableLeads} dormant lead(s) at the current conversion rate could be worth roughly ${forecasts[0]?.currency ?? ""}${estimatedValue.toLocaleString()}. Indicative only.`
        : `${recoverableLeads} dormant lead(s) and ${hotLeads} hot lead(s) are re-engageable. Set a deal value in the forecast for a monetary estimate.`,
  };

  const headline =
    `Marketing readiness ${score.total}/100 (${score.label}). ` +
    `${topOpportunities.length} live opportunit${topOpportunities.length === 1 ? "y" : "ies"}, ` +
    `${topRisks.length} risk${topRisks.length === 1 ? "" : "s"}.`;

  return {
    source: "growthmind",
    role: "CMO",
    generatedAt: new Date().toISOString(),
    marketingReadinessScore: score.total,
    grade: score.grade,
    label: score.label,
    readiness,
    topOpportunities,
    topRisks,
    revenueOpportunity,
    missingMarketingAssets,
    recommendedActions,
    recentMarketingReports,
    headline,
  };
}

// ── HiveMind (COO) executive summary ───────────────────────────────────────────
// Whitelists ONLY safe derived fields from fetchFullPlatformData — never forwards
// the raw `cfg` (workspace settings / secrets) or agent settings.
export async function buildHiveMindExecutiveSummary(
  sb: any,
  workspaceId: string,
): Promise<HiveMindExecutiveSummary> {
  const d: any = await fetchFullPlatformData(sb, workspaceId);

  const pipeline = Object.entries((d.leads?.stageCounts ?? {}) as Record<string, number>)
    .map(([stage, count]) => ({ stage, count: Number(count) }))
    .sort((a, b) => b.count - a.count);

  const headline =
    `Operations: ${d.leads?.total ?? 0} leads (${d.leads?.active ?? 0} active, ${d.leads?.idle ?? 0} idle), ` +
    `${d.bookings?.thisMonth ?? 0} booking(s) this month, ${d.calls?.successRate ?? 0}% call success, ` +
    `$${d.costs?.totalDollars ?? 0} spend (30d).`;

  return {
    source: "hivemind",
    role: "COO",
    generatedAt: new Date().toISOString(),
    leads: {
      total: d.leads?.total ?? 0,
      active: d.leads?.active ?? 0,
      idle: d.leads?.idle ?? 0,
      newThisMonth: d.month?.leads ?? 0,
      conversionRate: d.leads?.conversionRate ?? 0,
    },
    calls: {
      total: d.calls?.total ?? 0,
      successRate: d.calls?.successRate ?? 0,
      thisMonth: d.calls?.thisMonth ?? 0,
    },
    bookings: {
      total: d.bookings?.total ?? 0,
      thisMonth: d.bookings?.thisMonth ?? 0,
      thisWeek: d.bookings?.thisWeek ?? 0,
    },
    campaigns: {
      total: d.campaigns?.total ?? 0,
      active: d.campaigns?.active ?? 0,
      stalled: d.campaigns?.stalled ?? 0,
    },
    pipeline,
    cost: {
      totalDollars: d.costs?.totalDollars ?? 0,
      costPerLead: d.costs?.costPerLead ?? 0,
      totalMinutes: d.costs?.totalMinutes ?? 0,
    },
    systemHealth: d.systemHealth ?? {},
    headline,
  };
}

// ── SystemMind (CTO) executive summary ─────────────────────────────────────────
// Reuses the SystemMind telemetry aggregator + deterministic summary builder — no
// secrets are forwarded, only the boolean health flags and derived counts.
export async function buildSystemMindExecutiveSummary(
  _sb: any,
  workspaceId: string,
): Promise<SystemMindExecutiveSummary> {
  const data = await computeSystemMindData(workspaceId);
  return buildSystemMindSummary(data);
}

// ── Council master summary ─────────────────────────────────────────────────────
export async function buildExecutiveCouncilSummary(
  sb: any,
  workspaceId: string,
): Promise<ExecutiveCouncilSummary> {
  const [operations, marketing] = await Promise.all([
    buildHiveMindExecutiveSummary(sb, workspaceId),
    buildGrowthMindExecutiveSummary(sb, workspaceId),
  ]);

  const topOpportunity       = marketing.topOpportunities[0] ?? null;
  const topRisk              = marketing.topRisks[0] ?? null;
  const topRecommendedAction = marketing.recommendedActions[0] ?? null;

  const headline = `${operations.headline} ${marketing.headline}`;

  return {
    generatedAt: new Date().toISOString(),
    council: EXECUTIVE_COUNCIL,
    operations,
    marketing,
    topOpportunity,
    topRisk,
    topRecommendedAction,
    headline,
  };
}

// ── Executive event log helpers ────────────────────────────────────────────────
export async function insertExecutiveEvent(
  sb: any,
  workspaceId: string,
  ev: { source: ExecSource; event_type: string; summary: string; severity?: "info" | "warning" | "critical" },
): Promise<{ ok: boolean; deduped?: boolean }> {
  try {
    // Dedup: skip an identical source+event_type recorded in the last 6 hours.
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await sb
      .from("executive_events")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("source", ev.source)
      .eq("event_type", ev.event_type)
      .gte("created_at", since)
      .limit(1);
    if (existing && existing.length > 0) return { ok: true, deduped: true };

    const { error } = await sb.from("executive_events").insert({
      workspace_id: workspaceId,
      source: ev.source,
      event_type: ev.event_type,
      summary: ev.summary,
      severity: ev.severity ?? "info",
    });
    if (error) return { ok: false };
    return { ok: true };
  } catch {
    // Table may not be migrated yet — fail silently.
    return { ok: false };
  }
}

export async function selectExecutiveEvents(
  sb: any,
  workspaceId: string,
  limit = 20,
): Promise<ExecutiveEvent[]> {
  try {
    const { data } = await sb
      .from("executive_events")
      .select("id, source, event_type, summary, severity, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []) as ExecutiveEvent[];
  } catch {
    return [];
  }
}
