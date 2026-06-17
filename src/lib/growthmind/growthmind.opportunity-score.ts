// SERVER ONLY — never import from a client component.
// Service Opportunity Score Engine — scores each service/product in the Business DNA
// across six dimensions and persists to growthmind_service_scores.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildBusinessContext, type BusinessContext } from "./growthmind.business-context";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ServiceScoreDimension = {
  key:    string;
  label:  string;
  score:  number; // 0–100
  note:   string;
};

export type ServiceOpportunityScore = {
  id?:          string;
  serviceName:  string;
  totalScore:   number; // 0–100
  dimensions:   ServiceScoreDimension[];
  recommendation: string;
  computedAt:   string;
};

// ── Scoring helpers ────────────────────────────────────────────────────────────

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function scoreMarketDemand(ctx: BusinessContext, _service: string): ServiceScoreDimension {
  // Proxy: new leads (demand signal), call volume, and lead growth trend
  let score = 40;
  if (ctx.newLeads7d >= 5)       score += 15;
  else if (ctx.newLeads7d >= 2)  score += 8;
  if (ctx.newLeads30d >= 20)     score += 15;
  else if (ctx.newLeads30d >= 8) score += 8;
  const wowPct = ctx.leadsTrend.wowPct ?? 0;
  if (wowPct > 10)  score += 15;
  else if (wowPct > 0) score += 8;
  else if (wowPct < -10) score -= 10;
  if (ctx.totalCalls > 50) score += 10;
  const note = ctx.newLeads30d > 0
    ? `${ctx.newLeads30d} leads this month, ${ctx.leadsTrend.wowPct ?? 0}% WoW trend`
    : "No recent lead data — demand signals limited";
  return { key: "market_demand", label: "Market Demand", score: clamp(score), note };
}

function scoreCompetition(ctx: BusinessContext, _service: string): ServiceScoreDimension {
  // Inverse: fewer tracked competitors = less competitive pressure = higher score
  let score = 60;
  if (ctx.competitorsCount === 0)      score += 20;
  else if (ctx.competitorsCount <= 2)  score += 10;
  else if (ctx.competitorsCount >= 5)  score -= 15;
  if (ctx.uniqueSellingPoints)         score += 15;
  if (ctx.competitorsSummary)          score += 5;
  const note = ctx.competitorsCount === 0
    ? "No competitor data — differentiation advantage unmeasured"
    : `${ctx.competitorsCount} competitor(s) tracked${ctx.uniqueSellingPoints ? "; USPs defined" : ""}`;
  return { key: "competition", label: "Competition Level", score: clamp(score), note };
}

function scoreProfitPotential(ctx: BusinessContext, _service: string): ServiceScoreDimension {
  let score = 40;
  if (ctx.avgDealValue && ctx.avgDealValue > 1000)   score += 25;
  else if (ctx.avgDealValue && ctx.avgDealValue > 300) score += 12;
  if (ctx.profitMarginPct && ctx.profitMarginPct > 40)  score += 20;
  else if (ctx.profitMarginPct && ctx.profitMarginPct > 20) score += 10;
  if (ctx.conversionRate > 15) score += 15;
  else if (ctx.conversionRate > 5) score += 8;
  const note = ctx.avgDealValue
    ? `£${ctx.avgDealValue} avg deal value, ${ctx.profitMarginPct ?? "?"}% margin, ${ctx.conversionRate}% conversion`
    : "Configure deal value & margin in Business DNA for accurate scoring";
  return { key: "profit_potential", label: "Profit Potential", score: clamp(score), note };
}

function scoreEaseOfSale(ctx: BusinessContext, _service: string): ServiceScoreDimension {
  let score = 50;
  if (ctx.totalBookings > 20)      score += 15;
  else if (ctx.totalBookings > 5)  score += 8;
  if (ctx.callSuccessRate > 60)    score += 15;
  else if (ctx.callSuccessRate > 30) score += 7;
  if (ctx.salesProcess)            score += 10;
  if (ctx.offers)                  score += 10;
  const note = `${ctx.totalBookings} bookings, ${ctx.callSuccessRate}% call success rate` +
    (ctx.salesProcess ? " — sales process documented" : " — define sales process in DNA for better scoring");
  return { key: "ease_of_sale", label: "Ease of Sale", score: clamp(score), note };
}

function scoreLeadAvailability(ctx: BusinessContext, _service: string): ServiceScoreDimension {
  let score = 35;
  if (ctx.totalLeads > 200)       score += 30;
  else if (ctx.totalLeads > 50)   score += 20;
  else if (ctx.totalLeads > 10)   score += 10;
  if (ctx.activeCampaigns > 0)    score += 15;
  if (ctx.systemHealth.whatsapp)  score += 10;
  if (ctx.seoKeywords > 5)        score += 10;
  const note = `${ctx.totalLeads} total leads, ${ctx.activeLeads} active, ${ctx.activeCampaigns} active campaign(s)`;
  return { key: "lead_availability", label: "Lead Availability", score: clamp(score), note };
}

function scoreTrendStrength(ctx: BusinessContext, _service: string): ServiceScoreDimension {
  let score = 50;
  const leadWow = ctx.leadsTrend.wowPct ?? 0;
  const leadMom = ctx.leadsTrend.momPct ?? 0;
  const convWow = ctx.convRateTrend.wowPct ?? 0;
  if (leadWow > 10)       score += 20;
  else if (leadWow > 0)   score += 10;
  else if (leadWow < -10) score -= 15;
  if (leadMom > 20)       score += 10;
  else if (leadMom > 5)   score += 5;
  else if (leadMom < -20) score -= 10;
  if (convWow > 0)        score += 10;
  else if (convWow < 0)   score -= 5;
  if (ctx.recentContentCount > 0) score += 5;
  const dir = leadWow > 5 ? "Growing" : leadWow < -5 ? "Declining" : "Stable";
  const note = `${dir} — lead WoW ${leadWow > 0 ? "+" : ""}${leadWow}%, MoM ${leadMom > 0 ? "+" : ""}${leadMom}%`;
  return { key: "trend_strength", label: "Trend Strength", score: clamp(score), note };
}

function buildRecommendation(service: string, total: number, dims: ServiceScoreDimension[]): string {
  const sorted = [...dims].sort((a, b) => a.score - b.score);
  const weakest = sorted[0];
  if (total >= 75) return `"${service}" is a strong opportunity — prioritise in your next campaign.`;
  if (total >= 55) return `"${service}" has solid potential; improve ${weakest.label.toLowerCase()} to accelerate growth.`;
  if (total >= 35) return `"${service}" needs work on ${weakest.label.toLowerCase()} before scaling investment.`;
  return `"${service}" scores low — review Business DNA data accuracy or deprioritise for now.`;
}

export function computeServiceScores(ctx: BusinessContext): ServiceOpportunityScore[] {
  const serviceNames = [...ctx.services, ...ctx.products].filter(Boolean);
  if (serviceNames.length === 0) return [];

  return serviceNames.map(name => {
    const dims: ServiceScoreDimension[] = [
      scoreMarketDemand(ctx, name),
      scoreCompetition(ctx, name),
      scoreProfitPotential(ctx, name),
      scoreEaseOfSale(ctx, name),
      scoreLeadAvailability(ctx, name),
      scoreTrendStrength(ctx, name),
    ];
    const total = clamp(Math.round(dims.reduce((s, d) => s + d.score, 0) / dims.length));
    return {
      serviceName: name,
      totalScore: total,
      dimensions: dims,
      recommendation: buildRecommendation(name, total, dims),
      computedAt: new Date().toISOString(),
    };
  }).sort((a, b) => b.totalScore - a.totalScore);
}

// ── Server functions ───────────────────────────────────────────────────────────

export const getServiceOpportunityScores = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    try {
      const { data } = await sb
        .from("growthmind_service_scores")
        .select("id, service_name, total_score, scores, recommendation, computed_at")
        .eq("workspace_id", workspaceId)
        .order("total_score", { ascending: false })
        .limit(30);
      return { scores: (data ?? []).map((r: any) => ({
        id:             r.id,
        serviceName:    r.service_name,
        totalScore:     r.total_score,
        dimensions:     r.scores?.dimensions ?? [],
        recommendation: r.recommendation,
        computedAt:     r.computed_at,
      })) as ServiceOpportunityScore[] };
    } catch {
      return { scores: [] };
    }
  });

export const runServiceScoring = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const ctx = await buildBusinessContext(sb, workspaceId);
    const scores = computeServiceScores(ctx);
    if (scores.length === 0) return { ok: true, count: 0 };

    await Promise.resolve(sb.from("growthmind_service_scores").delete().eq("workspace_id", workspaceId)).catch(() => {});

    const rows = scores.map(s => ({
      workspace_id:   workspaceId,
      service_name:   s.serviceName,
      total_score:    s.totalScore,
      scores:         { dimensions: s.dimensions },
      recommendation: s.recommendation,
      computed_at:    s.computedAt,
    }));

    await Promise.resolve(sb.from("growthmind_service_scores").insert(rows)).catch(() => {});
    return { ok: true, count: scores.length, scores };
  });
