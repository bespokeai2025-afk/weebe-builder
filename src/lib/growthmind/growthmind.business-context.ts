// SERVER ONLY — never import from a client component.
// buildBusinessContext() aggregates data from all connected sources and returns
// a rich, AI-ready context object consumed by the CMO engines.

import { buildGrowthMindData } from "./growthmind.functions";
import type { InvoiceSalesSummary } from "@/lib/accountsmind/invoice-sales.server";

export type PipelineStageSnapshot = {
  stage:     string;
  count:     number;
  pctOfTotal: number;
};

export type CallSentimentSnapshot = {
  positive: number;
  negative: number;
  neutral:  number;
  totalWithSentiment: number;
  positiveRate: number;
};

export type CampaignPerformanceDelta = {
  activeCampaigns:   number;
  campaignsLast30d:  number;
  campaignsPrev30d:  number;
  activatedThisMonth: boolean;
  emailEnrolmentsLast30d: number;
};

export type BusinessContext = {
  companyName:        string | null;
  industry:           string | null;
  services:           string[];
  products:           string[];
  uniqueSellingPoints: string | null;
  idealCustomerProfiles: string | null;
  targetMarkets:      string | null;
  offers:             string | null;
  brandVoice:         string | null;
  locations:          string | null;
  monthlyBudget:      number | null;
  avgDealValue:       number | null;
  profitMarginPct:    number | null;
  mainGrowthObjective: string | null;
  competitorsSummary: string | null;
  revenueGoals:       string | null;
  salesProcess:       string | null;
  // Live business data signals
  totalLeads:         number;
  activeLeads:        number;
  salesDone:          number;
  conversionRate:     number;
  totalCalls:         number;
  callSuccessRate:    number;
  totalBookings:      number;
  waMessages:         number;
  waOutbound:         number;
  activeCampaigns:    number;
  seoKeywords:        number;
  recentContentCount: number;
  competitorsCount:   number;
  newLeads7d:         number;
  newLeads30d:        number;
  // Trend deltas
  leadsTrend:         { wowPct: number | null; momPct: number | null };
  callsTrend:         { wowPct: number | null; momPct: number | null };
  convRateTrend:      { wowPct: number | null; momPct: number | null };
  // Extended signals (Phase 2)
  pipelineStages:     PipelineStageSnapshot[];
  stalledStage:       string | null;       // stage with most stalled leads
  callSentiment:      CallSentimentSnapshot;
  campaignPerformance: CampaignPerformanceDelta;
  hexmailEnrolments:  number;
  waReplyRate:        number | null;       // inbound/outbound ratio (%) last 30d
  // Invoiced sales (AccountsMind invoices billed to this workspace)
  invoiceSales:       InvoiceSalesSummary | null;
  // Raw helpers
  systemHealth:       Record<string, boolean>;
};

function parseList(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return raw.split(/[,\n;]/).map(s => s.trim()).filter(Boolean);
}

export async function buildBusinessContext(sb: any, workspaceId: string): Promise<BusinessContext> {
  const now = new Date();
  const s30 = new Date(now.getTime() - 30 * 86400000).toISOString();
  const s60 = new Date(now.getTime() - 60 * 86400000).toISOString();

  const [growthData, dnaRes, allLeadsRes, recentCallsRes, campaignsRes, hexmailEnrolRes, waRes, invoiceSales] = await Promise.all([
    buildGrowthMindData(sb, workspaceId),
    sb.from("growthmind_business_dna")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle()
      .catch(() => ({ data: null })),
    // Pipeline stage distribution
    sb.from("leads")
      .select("id, status, pipeline_stage, updated_at")
      .eq("workspace_id", workspaceId)
      .limit(3000)
      .catch(() => ({ data: [] })),
    // Call sentiment distribution (last 60d)
    sb.from("calls")
      .select("id, started_at, call_successful, sentiment")
      .eq("workspace_id", workspaceId)
      .gte("started_at", s60)
      .limit(2000)
      .catch(() => ({ data: [] })),
    // Campaign performance delta
    sb.from("campaigns")
      .select("id, status, created_at")
      .eq("workspace_id", workspaceId)
      .limit(200)
      .catch(() => ({ data: [] })),
    // HexMail enrolments
    sb.from("hexmail_campaign_enrollments")
      .select("id, status, enrolled_at")
      .eq("workspace_id", workspaceId)
      .gte("enrolled_at", s30)
      .limit(300)
      .catch(() => ({ data: [] })),
    // WhatsApp reply rate
    sb.from("whatsapp_messages")
      .select("id, direction, created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", s30)
      .limit(1000)
      .catch(() => ({ data: [] })),
    // Paid-invoice sales figures for this workspace (dynamic import keeps the
    // admin client out of any client bundle that transitively imports this file).
    import("@/lib/accountsmind/invoice-sales.server")
      .then((m) => m.getInvoiceSalesSummary(workspaceId))
      .catch(() => null),
  ]);

  const dna: any = (dnaRes as any)?.data ?? null;
  const d = growthData as any;

  const allLeads: any[]    = (allLeadsRes as any).data ?? [];
  const recentCalls: any[] = (recentCallsRes as any).data ?? [];
  const allCampaigns: any[] = (campaignsRes as any).data ?? [];
  const hexEnrols: any[]   = (hexmailEnrolRes as any).data ?? [];
  const waMsgs: any[]      = (waRes as any).data ?? [];

  // Pipeline stage distribution
  const stageMap: Record<string, number> = {};
  const activeLeads = allLeads.filter(l =>
    l.status !== "sale_done" && l.status !== "do_not_call" && l.status !== "not_interested"
  );
  for (const l of activeLeads) {
    const stage = l.pipeline_stage ?? l.status ?? "unassigned";
    stageMap[stage] = (stageMap[stage] ?? 0) + 1;
  }
  const totalStaged = Object.values(stageMap).reduce((a, b) => a + b, 0);
  const pipelineStages: PipelineStageSnapshot[] = Object.entries(stageMap)
    .sort((a, b) => b[1] - a[1])
    .map(([stage, count]) => ({
      stage,
      count,
      pctOfTotal: totalStaged > 0 ? Math.round((count / totalStaged) * 100) : 0,
    }));
  const stalledStage = pipelineStages[0]?.stage ?? null;

  // Call sentiment distribution
  const withSentiment = recentCalls.filter(c => c.sentiment);
  const callSentiment: CallSentimentSnapshot = {
    positive: withSentiment.filter(c => c.sentiment?.toLowerCase() === "positive").length,
    negative: withSentiment.filter(c => c.sentiment?.toLowerCase() === "negative").length,
    neutral:  withSentiment.filter(c => !["positive","negative"].includes(c.sentiment?.toLowerCase() ?? "")).length,
    totalWithSentiment: withSentiment.length,
    positiveRate: withSentiment.length > 0
      ? Math.round((withSentiment.filter(c => c.sentiment?.toLowerCase() === "positive").length / withSentiment.length) * 100)
      : 0,
  };

  // Campaign performance delta
  const campaignsLast30 = allCampaigns.filter(c => c.created_at >= s30).length;
  const campaignsPrev30 = allCampaigns.filter(c => c.created_at >= s60 && c.created_at < s30).length;
  const campaignPerformance: CampaignPerformanceDelta = {
    activeCampaigns:      allCampaigns.filter(c => c.status === "active").length,
    campaignsLast30d:     campaignsLast30,
    campaignsPrev30d:     campaignsPrev30,
    activatedThisMonth:   campaignsLast30 > 0,
    emailEnrolmentsLast30d: hexEnrols.length,
  };

  // WhatsApp reply rate
  const waOut = waMsgs.filter(m => m.direction === "outbound").length;
  const waIn  = waMsgs.filter(m => m.direction === "inbound").length;
  const waReplyRate = waOut > 0 ? Math.round((waIn / waOut) * 100) : null;

  return {
    companyName:          dna?.company_name ?? null,
    industry:             dna?.industry ?? null,
    services:             parseList(dna?.services),
    products:             parseList(dna?.products),
    uniqueSellingPoints:  dna?.unique_selling_points ?? null,
    idealCustomerProfiles: dna?.ideal_customer_profiles ?? null,
    targetMarkets:        dna?.target_markets ?? null,
    offers:               dna?.offers ?? null,
    brandVoice:           dna?.brand_voice ?? null,
    locations:            dna?.locations ?? null,
    monthlyBudget:        dna?.monthly_marketing_budget ?? null,
    avgDealValue:         dna?.average_deal_value ?? null,
    profitMarginPct:      dna?.profit_margin_pct ?? null,
    mainGrowthObjective:  dna?.main_growth_objective ?? null,
    competitorsSummary:   dna?.competitors_summary ?? null,
    revenueGoals:         dna?.revenue_goals ?? null,
    salesProcess:         dna?.sales_process ?? null,
    totalLeads:           d.leads?.total ?? 0,
    activeLeads:          d.leads?.active ?? 0,
    salesDone:            d.leads?.sales ?? 0,
    conversionRate:       d.leads?.conversionRate ?? 0,
    totalCalls:           d.calls?.total ?? 0,
    callSuccessRate:      d.calls?.successRate ?? 0,
    totalBookings:        d.bookings?.total ?? 0,
    waMessages:           d.whatsapp?.total ?? 0,
    waOutbound:           d.whatsapp?.outbound ?? 0,
    activeCampaigns:      d.campaigns?.active ?? 0,
    seoKeywords:          d.marketing?.seoKeywords ?? 0,
    recentContentCount:   d.marketing?.recentContentCount ?? 0,
    competitorsCount:     d.marketing?.competitorsCount ?? 0,
    newLeads7d:           d.leads?.newLast7 ?? 0,
    newLeads30d:          d.leads?.newLast30 ?? 0,
    leadsTrend:           d.trends?.leads   ?? { wowPct: null, momPct: null },
    callsTrend:           d.trends?.calls   ?? { wowPct: null, momPct: null },
    convRateTrend:        d.trends?.conversionRate ?? { wowPct: null, momPct: null },
    pipelineStages,
    stalledStage,
    callSentiment,
    campaignPerformance,
    hexmailEnrolments:    hexEnrols.length,
    waReplyRate,
    invoiceSales:         invoiceSales ?? null,
    systemHealth:         d.systemHealth ?? {},
  };
}

export function formatContextForAI(ctx: BusinessContext): string {
  const lines: string[] = [];
  if (ctx.companyName) lines.push(`Company: ${ctx.companyName}`);
  if (ctx.industry)    lines.push(`Industry: ${ctx.industry}`);
  if (ctx.services.length)  lines.push(`Services: ${ctx.services.join(", ")}`);
  if (ctx.products.length)  lines.push(`Products: ${ctx.products.join(", ")}`);
  if (ctx.uniqueSellingPoints) lines.push(`USPs: ${ctx.uniqueSellingPoints}`);
  if (ctx.idealCustomerProfiles) lines.push(`Ideal Customers: ${ctx.idealCustomerProfiles}`);
  if (ctx.targetMarkets) lines.push(`Target Markets: ${ctx.targetMarkets}`);
  if (ctx.offers)      lines.push(`Current Offers: ${ctx.offers}`);
  if (ctx.locations)   lines.push(`Locations: ${ctx.locations}`);
  if (ctx.mainGrowthObjective) lines.push(`Growth Objective: ${ctx.mainGrowthObjective}`);
  if (ctx.monthlyBudget) lines.push(`Monthly Marketing Budget: £${ctx.monthlyBudget}`);
  if (ctx.avgDealValue)  lines.push(`Average Deal Value: £${ctx.avgDealValue}`);
  if (ctx.competitorsSummary) lines.push(`Competitors: ${ctx.competitorsSummary}`);
  lines.push("");
  lines.push(`Live Data Snapshot:`);
  lines.push(`  Total Leads: ${ctx.totalLeads} (${ctx.activeLeads} active, ${ctx.salesDone} converted)`);
  lines.push(`  Conversion Rate: ${ctx.conversionRate}%`);
  lines.push(`  Total Calls: ${ctx.totalCalls} (${ctx.callSuccessRate}% success rate)`);
  lines.push(`  Total Bookings: ${ctx.totalBookings}`);
  lines.push(`  Active Campaigns: ${ctx.activeCampaigns}`);
  lines.push(`  WhatsApp Messages (30d): ${ctx.waMessages} (${ctx.waOutbound} outbound)`);
  lines.push(`  SEO Keywords Tracked: ${ctx.seoKeywords}`);
  lines.push(`  Content Published (14d): ${ctx.recentContentCount}`);
  lines.push(`  New Leads This Week: ${ctx.newLeads7d}`);
  if (ctx.leadsTrend.wowPct !== null)   lines.push(`  Lead Growth WoW: ${ctx.leadsTrend.wowPct}%`);
  if (ctx.convRateTrend.momPct !== null) lines.push(`  Conversion Rate MoM: ${ctx.convRateTrend.momPct}%`);
  if (ctx.callSentiment.totalWithSentiment > 0) {
    lines.push(`  Call Sentiment: ${ctx.callSentiment.positiveRate}% positive (${ctx.callSentiment.positive} pos / ${ctx.callSentiment.negative} neg / ${ctx.callSentiment.neutral} neutral)`);
  }
  if (ctx.stalledStage) {
    const top = ctx.pipelineStages[0];
    lines.push(`  Biggest Pipeline Bottleneck: "${ctx.stalledStage}" stage (${top?.count ?? 0} leads, ${top?.pctOfTotal ?? 0}% of active pipeline)`);
  }
  if (ctx.waReplyRate !== null) {
    lines.push(`  WhatsApp Reply Rate: ${ctx.waReplyRate}%`);
  }
  if (ctx.campaignPerformance.emailEnrolmentsLast30d > 0) {
    lines.push(`  Email Sequence Enrolments (30d): ${ctx.campaignPerformance.emailEnrolmentsLast30d}`);
  }
  lines.push(`  Active Campaigns: ${ctx.campaignPerformance.activeCampaigns} (${ctx.campaignPerformance.campaignsLast30d} new this month)`);
  if (ctx.invoiceSales && ctx.invoiceSales.invoiceCount > 0) {
    const inv = ctx.invoiceSales;
    const fmt = (c: number) => `${inv.currency} ${(c / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
    lines.push(`  Invoiced Sales: ${fmt(inv.paidSalesCents)} paid (${inv.paidCount}/${inv.invoiceCount} invoices), ${fmt(inv.outstandingCents)} outstanding${inv.overdueCount > 0 ? `, ${fmt(inv.overdueCents)} overdue (${inv.overdueCount})` : ""}`);
    if (inv.paidThisMonthCents > 0) lines.push(`  Invoice Payments This Month: ${fmt(inv.paidThisMonthCents)}`);
  }
  return lines.join("\n");
}
