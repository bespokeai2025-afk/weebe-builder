// ── Executive Bridge — server-only builders ────────────────────────────────────
// SERVER ONLY. Never import this from a client component / .tsx file. It is loaded
// dynamically inside the createServerFn handlers in `executive-bridge.ts`.
//
// These are pure async builders (sb, workspaceId) → secret-free summary objects.
// They REUSE the existing GrowthMind engines and HiveMind aggregator — no new
// marketing analytics are computed here.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
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
  type CmoServiceScore,
  type CmoTrendSignal,
  type CmoCampaignProposal,
  type CmoVideoProposal,
  type CmoFunnelInsight,
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
  const [forecastsRes, funnelsRes, plansRes, dnaRes, valuePointRes, storedOppsRes] = await Promise.all([
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
    // New DNA + intelligence tables (may not exist on older workspaces — always catch)
    Promise.resolve(
      sb.from("growthmind_business_dna")
        .select("company_name,industry,products,services,unique_selling_points,ideal_customer_profiles,offers,brand_voice,compliance_notes,target_markets,main_growth_objective,updated_at")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    ).catch(() => ({ data: null })),
    Promise.resolve(
      sb.from("growthmind_value_points")
        .select("current_highest_value,why_it_matters,who_to_target,best_channels,recommended_campaign,confidence_score,created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ).catch(() => ({ data: null })),
    Promise.resolve(
      sb.from("growthmind_opportunities")
        .select("id,title,category,urgency,confidence_score")
        .eq("workspace_id", workspaceId)
        .order("confidence_score", { ascending: false })
        .limit(5),
    ).catch(() => ({ data: [] })),
  ]);

  const forecasts = (forecastsRes as any).data ?? [];
  const funnels   = (funnelsRes as any).data ?? [];
  const plans     = (plansRes as any).data ?? [];
  const dna       = (dnaRes as any).data ?? null;
  const valuePoint = (valuePointRes as any).data ?? null;
  const storedOpps: any[] = (storedOppsRes as any).data ?? [];

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

  // DNA completion check
  if (dna) {
    const dnaFilledFields = Object.values(dna).filter(v => v && String(v).trim().length > 0).length;
    const dnaTotalFields  = Object.keys(dna).length - 2; // exclude updated_at etc.
    if (dnaFilledFields / Math.max(dnaTotalFields, 1) < 0.5) {
      missingMarketingAssets.push("Business DNA less than 50% complete — AI accuracy reduced");
    }
  } else {
    missingMarketingAssets.push("Business DNA not configured — GrowthMind AI quality is limited");
  }

  // Augment topOpportunities with stored engine results (higher quality, evidence-backed)
  if (storedOpps.length > 0) {
    const storedMapped: ExecOpportunity[] = storedOpps.map((o: any) => ({
      id: o.id,
      label: o.title,
      detail: `Category: ${o.category} · Urgency: ${o.urgency}`,
      urgency: o.urgency as "critical" | "high" | "medium" | "low",
    }));
    // Merge stored opps (replacing existing if ids overlap)
    const existingIds = new Set(topOpportunities.map((o: ExecOpportunity) => o.id));
    for (const so of storedMapped) {
      if (!existingIds.has(so.id)) topOpportunities.push(so);
    }
    topOpportunities.sort((a, b) => {
      const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a.urgency] ?? 3) - (order[b.urgency] ?? 3);
    });
    topOpportunities.splice(6);
  }

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

  // ── CMO Proactive Intelligence signals (best-effort; tables may not be migrated) ──
  const [serviceScoresRes, trendSignalsRes, campaignProposalsRes, videoProposalsRes] = await Promise.all([
    sb.from("growthmind_service_scores")
      .select("service_name, total_score, recommendation")
      .eq("workspace_id", workspaceId)
      .order("total_score", { ascending: false })
      .limit(1)
      .maybeSingle()
      .catch(() => ({ data: null })),
    sb.from("growthmind_trend_signals")
      .select("label, classification, insight, action_hint")
      .eq("workspace_id", workspaceId)
      .eq("classification", "Growing")
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .catch(() => ({ data: null })),
    sb.from("growthmind_campaign_proposals")
      .select("title, reason, audience, channels, expected_outcome, budget_estimate")
      .eq("workspace_id", workspaceId)
      .eq("status", "draft")
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .catch(() => ({ data: null })),
    sb.from("growthmind_video_proposals")
      .select("title, hook, platform, duration")
      .eq("workspace_id", workspaceId)
      .eq("status", "draft")
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .catch(() => ({ data: null })),
  ]);

  const topServiceRaw    = (serviceScoresRes as any).data ?? null;
  const topTrendRaw      = (trendSignalsRes as any).data ?? null;
  const topCampaignRaw   = (campaignProposalsRes as any).data ?? null;
  const topVideoRaw      = (videoProposalsRes as any).data ?? null;

  const topService: CmoServiceScore | null = topServiceRaw ? {
    name:           topServiceRaw.service_name,
    score:          topServiceRaw.total_score,
    recommendation: topServiceRaw.recommendation ?? "",
  } : null;

  const fastestGrowingSegment: CmoTrendSignal | null = topTrendRaw ? {
    label:          topTrendRaw.label,
    classification: topTrendRaw.classification,
    insight:        topTrendRaw.insight ?? "",
    actionHint:     topTrendRaw.action_hint ?? "",
  } : null;

  const topCampaignProposal: CmoCampaignProposal | null = topCampaignRaw ? {
    title:           topCampaignRaw.title,
    reason:          topCampaignRaw.reason ?? "",
    audience:        topCampaignRaw.audience ?? "",
    channels:        topCampaignRaw.channels ?? [],
    expectedOutcome: topCampaignRaw.expected_outcome ?? "",
    budgetEstimate:  topCampaignRaw.budget_estimate ?? "",
  } : null;

  const topVideoProposal: CmoVideoProposal | null = topVideoRaw ? {
    title:    topVideoRaw.title,
    hook:     topVideoRaw.hook ?? "",
    platform: topVideoRaw.platform ?? "",
    duration: topVideoRaw.duration ?? "",
  } : null;

  // Recommended funnel insight — find stage with highest lead count (proxy for drop-off)
  let recommendedFunnel: CmoFunnelInsight | null = null;
  {
    const d = data as any;
    const stageCounts: Record<string, number> = {};
    const leads: any[] = d.leads?.staleLeadDetail ?? [];
    for (const l of (d as any).leads?.stalledPipeline ?? []) {
      stageCounts[l.pipeline_stage ?? l.status ?? "unknown"] = (stageCounts[l.pipeline_stage ?? l.status ?? "unknown"] ?? 0) + 1;
    }
    const topStage = Object.entries(stageCounts).sort((a, b) => b[1] - a[1])[0];
    if (topStage) {
      recommendedFunnel = {
        stage:   topStage[0],
        dropOff: topStage[1],
        hint:    `${topStage[1]} leads stalled at "${topStage[0]}" stage — add a re-engagement sequence here.`,
      };
    }
  }

  // Recommended budget estimate
  const d = data as any;
  const budgetBase    = dna?.monthly_marketing_budget ?? null;
  const recommendedBudget: string | null = budgetBase
    ? `£${Math.round(budgetBase * 0.6).toLocaleString()} of £${budgetBase.toLocaleString()} monthly budget recommended for top-3 channels`
    : score.total < 40
      ? "Start with £200–500/month on 1 channel; scale when conversion rate exceeds 5%"
      : score.total < 70
        ? "£500–1,500/month split across AI calling, WhatsApp, and 1 paid channel"
        : "£1,500+/month — diversify across 3+ channels; strong readiness score supports scale";

  // Recommended next action — single CTA
  const criticalRec = recs.find(r => r.priority === "critical");
  const highRec     = recs.find(r => r.priority === "high");
  const primaryRec  = criticalRec ?? highRec;
  const recommendedNextAction: string | null = topCampaignProposal
    ? `Run Campaign: "${topCampaignProposal.title}" — ${topCampaignProposal.expectedOutcome}`
    : primaryRec
      ? `${primaryRec.fix}`
      : topService
        ? `Focus on "${topService.name}" (score ${topService.score}/100): ${topService.recommendation}`
        : null;

  // Growth forecast summary
  const latestForecast = forecasts[0];
  const growthForecastSummary: string | null = latestForecast
    ? `${(latestForecast.scenario ?? "base").replace(/^\w/, (c: string) => c.toUpperCase())} scenario: ${latestForecast.currency ?? ""}${latestForecast.deal_value ? Number(latestForecast.deal_value).toLocaleString() : "—"} est. deal value`
    : topService && topService.score >= 70
      ? `Highest-opportunity service "${topService.name}" scores ${topService.score}/100 — strong growth potential`
      : null;

  const dnaNote = valuePoint
    ? ` Current value point: "${valuePoint.current_highest_value}".`
    : dna?.company_name
      ? ` Business DNA configured for ${dna.company_name}.`
      : " Business DNA not yet configured.";

  const cmoNote = topCampaignProposal
    ? ` CMO proposal: "${topCampaignProposal.title}".`
    : topService
      ? ` Top service: ${topService.name} (${topService.score}/100).`
      : "";

  const headline =
    `Marketing readiness ${score.total}/100 (${score.label}). ` +
    `${topOpportunities.length} live opportunit${topOpportunities.length === 1 ? "y" : "ies"}, ` +
    `${topRisks.length} risk${topRisks.length === 1 ? "" : "s"}.${dnaNote}${cmoNote}`;

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
    topService,
    fastestGrowingSegment,
    topCampaignProposal,
    topVideoProposal,
    growthForecastSummary,
    recommendedBudget,
    recommendedNextAction,
    recommendedFunnel,
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
  const summary = buildSystemMindSummary(data);

  // Enrich with workflow-intelligence counts (graceful — tables may not yet exist)
  try {
    const sb = supabaseAdmin as any;
    const [libResult, patResult, pbResult] = await Promise.all([
      sb
        .from("systemmind_workflow_library")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId),
      sb
        .from("systemmind_workflow_patterns")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId),
      sb
        .from("systemmind_repair_playbooks")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId),
    ]);
    summary.workflowLibraryCount  = libResult.count ?? 0;
    summary.workflowPatternsCount = patResult.count ?? 0;
    summary.playbooksCount        = pbResult.count  ?? 0;
  } catch { /* graceful — tables not yet migrated */ }

  return summary;
}

// ── Council master summary ─────────────────────────────────────────────────────
export async function buildExecutiveCouncilSummary(
  sb: any,
  workspaceId: string,
): Promise<ExecutiveCouncilSummary> {
  const [operations, marketing, system] = await Promise.all([
    buildHiveMindExecutiveSummary(sb, workspaceId),
    buildGrowthMindExecutiveSummary(sb, workspaceId),
    buildSystemMindExecutiveSummary(sb, workspaceId),
  ]);

  const topOpportunity       = marketing.topOpportunities[0] ?? null;
  const topRisk              = marketing.topRisks[0]          ?? system.topRisks[0]          ?? null;
  const topRecommendedAction = marketing.recommendedActions[0] ?? system.recommendedActions[0] ?? null;

  const systemNote = system.workflowLibraryCount != null && system.workflowLibraryCount > 0
    ? ` CTO: ${system.workflowLibraryCount} workflow${system.workflowLibraryCount !== 1 ? "s" : ""} in library${system.playbooksCount ? `, ${system.playbooksCount} repair playbooks` : ""}.`
    : "";
  const headline = `${operations.headline} ${marketing.headline}${systemNote}`.trim();

  return {
    generatedAt: new Date().toISOString(),
    council: EXECUTIVE_COUNCIL,
    operations,
    marketing,
    system,
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
