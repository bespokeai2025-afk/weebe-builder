// SERVER ONLY — never import from a client component.
// Trend Engine — reads existing workspace data to identify trends across calls,
// leads, WhatsApp, email, and content. Classifies each as Emerging/Growing/Declining/Seasonal.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Types ──────────────────────────────────────────────────────────────────────

export type TrendClassification = "Emerging" | "Growing" | "Declining" | "Seasonal" | "Stable";

export type TrendSignal = {
  id?:          string;
  signalType:   string;
  label:        string;
  classification: TrendClassification;
  currentValue: number;
  previousValue: number;
  changePercent: number | null;
  insight:      string;
  actionHint:   string;
  computedAt:   string;
};

// ── Classification helper ──────────────────────────────────────────────────────

function classify(curr: number, prev: number, isInverse = false): TrendClassification {
  if (curr === 0 && prev === 0) return "Stable";
  if (prev === 0 && curr > 0)   return "Emerging";
  if (prev === 0)                return "Stable";
  const pct = ((curr - prev) / prev) * 100;
  if (isInverse) {
    if (pct > 15) return "Declining"; // higher is worse (e.g. stale leads)
    if (pct < -15) return "Growing";
    return "Stable";
  }
  if (pct >= 30)  return "Growing";
  if (pct >= 5)   return "Growing";
  if (pct <= -20) return "Declining";
  if (pct <= -5)  return "Declining";
  return "Stable";
}

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0 && curr === 0) return null;
  if (prev === 0) return curr > 0 ? 100 : null;
  return Math.round(((curr - prev) / prev) * 100);
}

// ── Core detector ──────────────────────────────────────────────────────────────

export async function detectTrendSignals(sb: any, workspaceId: string): Promise<TrendSignal[]> {
  const now      = new Date();
  const s7       = new Date(now.getTime() - 7  * 86400000).toISOString();
  const s14      = new Date(now.getTime() - 14 * 86400000).toISOString();
  const s30      = new Date(now.getTime() - 30 * 86400000).toISOString();
  const s60      = new Date(now.getTime() - 60 * 86400000).toISOString();

  const [leadsRes, callsRes, waRes, hexmailEnrollRes, hexmailRes, calRes, campaignsRes] = await Promise.all([
    sb.from("leads").select("id, created_at, updated_at, status, source, pipeline_stage").eq("workspace_id", workspaceId).limit(5000),
    sb.from("calls").select("id, started_at, call_successful, duration_seconds, sentiment").eq("workspace_id", workspaceId).gte("started_at", s60).limit(5000),
    sb.from("whatsapp_messages").select("id, direction, created_at").eq("workspace_id", workspaceId).gte("created_at", s60).limit(2000).catch(() => ({ data: [] })),
    sb.from("hexmail_campaign_enrollments").select("id, status, enrolled_at, workspace_id").eq("workspace_id", workspaceId).gte("enrolled_at", s60).limit(500).catch(() => ({ data: [] })),
    sb.from("hexmail_campaigns").select("id, status, created_at").eq("workspace_id", workspaceId).limit(100).catch(() => ({ data: [] })),
    sb.from("growthmind_content_calendar").select("id, status, scheduled_date, channel").eq("workspace_id", workspaceId).limit(200).catch(() => ({ data: [] })),
    sb.from("campaigns").select("id, status, created_at").eq("workspace_id", workspaceId).limit(100).catch(() => ({ data: [] })),
  ]);

  const leads:       any[] = leadsRes.data   ?? [];
  const calls:       any[] = callsRes.data   ?? [];
  const waAll:       any[] = (waRes as any).data ?? [];
  const enrollments: any[] = (hexmailEnrollRes as any).data ?? [];
  const hexmail:     any[] = (hexmailRes as any).data ?? [];
  const calItems:    any[] = (calRes as any).data ?? [];
  const campaigns:   any[] = (campaignsRes as any).data ?? [];

  const signals: TrendSignal[] = [];
  const ts = new Date().toISOString();

  // ── 1. Lead Volume ─────────────────────────────────────────────────────────
  const leadsLast7  = leads.filter(l => l.created_at >= s7).length;
  const leadsPrev7  = leads.filter(l => l.created_at >= s14 && l.created_at < s7).length;
  const leadsLast30 = leads.filter(l => l.created_at >= s30).length;
  const leadsPrev30 = leads.filter(l => l.created_at >= s60 && l.created_at < s30).length;
  {
    const cls = classify(leadsLast7, leadsPrev7);
    const pct = pctChange(leadsLast7, leadsPrev7);
    signals.push({
      signalType:   "lead_volume",
      label:        "Lead Volume",
      classification: cls,
      currentValue: leadsLast7,
      previousValue: leadsPrev7,
      changePercent: pct,
      insight:      `${leadsLast7} new leads this week vs ${leadsPrev7} last week (${pct !== null ? (pct > 0 ? "+" : "") + pct + "%" : "n/a"}).`,
      actionHint:   cls === "Declining" ? "Ramp up outreach campaigns or paid ads to refill the pipeline."
                  : cls === "Growing"   ? "Maintain momentum — scale what's working to sustain growth."
                  : cls === "Emerging"  ? "New lead source emerging — identify origin and double down."
                  : "Lead volume is stable — focus on conversion rate improvements.",
      computedAt: ts,
    });
  }

  // ── 2. Call Success Rate ────────────────────────────────────────────────────
  const callsLast7  = calls.filter(c => c.started_at >= s7);
  const callsPrev7  = calls.filter(c => c.started_at >= s14 && c.started_at < s7);
  const succLast7   = callsLast7.filter(c => c.call_successful).length;
  const succPrev7   = callsPrev7.filter(c => c.call_successful).length;
  const rLast = callsLast7.length > 0 ? Math.round((succLast7 / callsLast7.length) * 100) : 0;
  const rPrev = callsPrev7.length > 0 ? Math.round((succPrev7 / callsPrev7.length) * 100) : 0;
  {
    const cls = classify(rLast, rPrev);
    signals.push({
      signalType:   "call_success_rate",
      label:        "Call Success Rate",
      classification: cls,
      currentValue: rLast,
      previousValue: rPrev,
      changePercent: pctChange(rLast, rPrev),
      insight:      `${rLast}% success rate this week (${callsLast7.length} calls) vs ${rPrev}% last week.`,
      actionHint:   cls === "Declining" ? "Review call scripts and agent knowledge bases — declining success rate signals script or targeting issues."
                  : cls === "Growing"   ? "Success rate improving — replicate winning agent flows across all agents."
                  : "Call performance stable — A/B test different opening lines to push improvement.",
      computedAt: ts,
    });
  }

  // ── 3. Conversion Rate ─────────────────────────────────────────────────────
  const cohortLast30 = leads.filter(l => l.created_at >= s30);
  const cohortPrev30 = leads.filter(l => l.created_at >= s60 && l.created_at < s30);
  const convLast = cohortLast30.length > 0 ? Math.round((cohortLast30.filter(l => l.status === "sale_done").length / cohortLast30.length) * 100) : 0;
  const convPrev = cohortPrev30.length > 0 ? Math.round((cohortPrev30.filter(l => l.status === "sale_done").length / cohortPrev30.length) * 100) : 0;
  {
    const cls = classify(convLast, convPrev);
    signals.push({
      signalType:   "conversion_rate",
      label:        "Conversion Rate",
      classification: cls,
      currentValue: convLast,
      previousValue: convPrev,
      changePercent: pctChange(convLast, convPrev),
      insight:      `${convLast}% conversion this month vs ${convPrev}% prior month.`,
      actionHint:   cls === "Declining" ? "Conversion rate falling — analyse objections in recent call summaries and tighten qualification criteria."
                  : cls === "Growing"   ? "Conversion improving — identify which agents or scripts are driving it and standardise."
                  : "Conversion stable — focus on increasing lead volume to grow revenue.",
      computedAt: ts,
    });
  }

  // ── 4. WhatsApp Outbound Engagement ────────────────────────────────────────
  const waLast30 = waAll.filter(m => m.direction === "outbound" && m.created_at >= s30).length;
  const waPrev30 = waAll.filter(m => m.direction === "outbound" && m.created_at >= s60 && m.created_at < s30).length;
  {
    const cls = classify(waLast30, waPrev30);
    signals.push({
      signalType:   "whatsapp_outbound",
      label:        "WhatsApp Outbound",
      classification: cls,
      currentValue: waLast30,
      previousValue: waPrev30,
      changePercent: pctChange(waLast30, waPrev30),
      insight:      `${waLast30} outbound WhatsApp messages this month vs ${waPrev30} prior month.`,
      actionHint:   waLast30 === 0  ? "WhatsApp not being used for outreach — connect and launch a broadcast to your leads."
                  : cls === "Declining" ? "WhatsApp engagement declining — schedule a broadcast campaign to re-engage contacts."
                  : cls === "Growing"   ? "WhatsApp outreach is growing — continue scaling this high-engagement channel."
                  : "WhatsApp engagement stable — test new message templates to improve response rates.",
      computedAt: ts,
    });
  }

  // ── 5. Lead Source Concentration ───────────────────────────────────────────
  const sourceMap: Record<string, number> = {};
  for (const l of leads.filter(l => l.created_at >= s30 && l.source)) {
    sourceMap[l.source] = (sourceMap[l.source] ?? 0) + 1;
  }
  const topSources = Object.entries(sourceMap).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const totalSourced = Object.values(sourceMap).reduce((a, b) => a + b, 0);
  if (topSources.length > 0) {
    const topPct = totalSourced > 0 ? Math.round((topSources[0][1] / totalSourced) * 100) : 0;
    const cls: TrendClassification = topPct > 70 ? "Declining" : topSources.length >= 3 ? "Growing" : "Stable";
    signals.push({
      signalType:   "lead_source_diversity",
      label:        "Lead Source Diversity",
      classification: cls,
      currentValue: topSources.length,
      previousValue: 1,
      changePercent: null,
      insight:      topSources.length > 0
        ? `Top source: "${topSources[0][0]}" (${topPct}% of leads). ${topSources.length} active source(s) this month.`
        : "No lead sources tracked this month.",
      actionHint:   topPct > 70 ? `Over-reliant on '${topSources[0][0]}' — add 2 more acquisition channels to reduce risk.`
                  : "Good source diversity — continue investing across multiple channels.",
      computedAt: ts,
    });
  }

  // ── 6. Stale Lead Accumulation ─────────────────────────────────────────────
  const staleLeads = leads.filter(l =>
    l.status !== "sale_done" && l.status !== "do_not_call" && l.status !== "not_interested" && l.updated_at < s14
  ).length;
  const stalePrev = leads.filter(l =>
    l.status !== "sale_done" && l.status !== "do_not_call" && l.status !== "not_interested" && l.updated_at < s30 && l.updated_at >= s60
  ).length;
  {
    const cls = classify(staleLeads, stalePrev, true);
    signals.push({
      signalType:   "stale_lead_accumulation",
      label:        "Stale Lead Accumulation",
      classification: staleLeads > stalePrev ? "Declining" : staleLeads < stalePrev ? "Growing" : "Stable",
      currentValue: staleLeads,
      previousValue: stalePrev,
      changePercent: pctChange(staleLeads, stalePrev),
      insight:      `${staleLeads} leads stale 14+ days (not updated). ${staleLeads > stalePrev ? "Increasing — pipeline health worsening." : "Decreasing — pipeline health improving."}`,
      actionHint:   staleLeads > 20 ? "Launch a re-engagement campaign immediately — stale leads go cold fast."
                  : staleLeads > 5  ? "Review and follow up with stale leads this week."
                  : "Pipeline freshness is healthy — maintain current follow-up cadence.",
      computedAt: ts,
    });
  }

  // ── 7. Content Calendar Activity ───────────────────────────────────────────
  const scheduledContent = calItems.filter((c: any) => c.status !== "Draft").length;
  const draftContent     = calItems.filter((c: any) => c.status === "Draft").length;
  {
    const cls: TrendClassification = scheduledContent > 4 ? "Growing" : scheduledContent > 0 ? "Stable" : draftContent > 0 ? "Emerging" : "Declining";
    signals.push({
      signalType:   "content_activity",
      label:        "Content Pipeline Activity",
      classification: cls,
      currentValue: scheduledContent,
      previousValue: 0,
      changePercent: null,
      insight:      `${scheduledContent} content piece(s) scheduled, ${draftContent} in draft. ${hexmail.filter((c: any) => c.status === "active").length} active email campaign(s).`,
      actionHint:   scheduledContent === 0 && draftContent === 0
        ? "No content scheduled — use Content Studio to generate and schedule posts for this week."
        : draftContent > 3
        ? `${draftContent} drafts sitting idle — publish or reschedule them to drive traffic.`
        : "Content pipeline healthy — aim for 4+ published pieces per month for compounding SEO growth.",
      computedAt: ts,
    });
  }

  // ── 8. CRM Stage Velocity ──────────────────────────────────────────────────
  // Measures how quickly leads are advancing through pipeline stages
  {
    const stageMap: Record<string, number> = {};
    const activeLeads = leads.filter(l =>
      l.status !== "sale_done" && l.status !== "do_not_call" && l.status !== "not_interested"
    );
    for (const l of activeLeads) {
      const stage = l.pipeline_stage ?? l.status ?? "unassigned";
      stageMap[stage] = (stageMap[stage] ?? 0) + 1;
    }
    const stageCount = Object.keys(stageMap).length;
    const movedLast7 = leads.filter(l => l.updated_at >= s7 && l.pipeline_stage && l.pipeline_stage !== "new").length;
    const movedPrev7 = leads.filter(l => l.updated_at >= s14 && l.updated_at < s7 && l.pipeline_stage && l.pipeline_stage !== "new").length;
    const cls = classify(movedLast7, movedPrev7);
    const topStage = Object.entries(stageMap).sort((a, b) => b[1] - a[1])[0];
    signals.push({
      signalType:   "crm_stage_velocity",
      label:        "CRM Pipeline Velocity",
      classification: cls,
      currentValue: movedLast7,
      previousValue: movedPrev7,
      changePercent: pctChange(movedLast7, movedPrev7),
      insight:      `${movedLast7} leads advanced stages this week vs ${movedPrev7} last week. ${stageCount} active stage(s) in use${topStage ? `; most stalled at "${topStage[0]}" (${topStage[1]} leads)` : ""}.`,
      actionHint:   movedLast7 < movedPrev7
        ? `Pipeline velocity slowing — ${topStage ? `focus on moving leads out of "${topStage[0]}"` : "review follow-up cadence"} to prevent stalling.`
        : movedLast7 > movedPrev7
        ? "Pipeline velocity improving — excellent. Ensure capacity to handle increased deal flow."
        : "Pipeline velocity stable — introduce automated follow-ups to accelerate stage progression.",
      computedAt: ts,
    });
  }

  // ── 9. Call Sentiment Trend ────────────────────────────────────────────────
  // Tracks the distribution of call sentiments over time (positive/negative/neutral)
  {
    const sentimentCodes: Record<string, number> = { "positive": 3, "neutral": 2, "negative": 1 };
    const callsLast14 = calls.filter(c => c.started_at >= s14);
    const callsPrev14 = calls.filter(c => c.started_at >= s30 && c.started_at < s14);

    function avgSentiment(arr: any[]) {
      if (arr.length === 0) return 0;
      const sentArr = arr.filter(c => c.sentiment);
      if (sentArr.length === 0) return 2; // neutral default
      return sentArr.reduce((sum, c) => sum + (sentimentCodes[c.sentiment?.toLowerCase()] ?? 2), 0) / sentArr.length;
    }

    const sentLast = avgSentiment(callsLast14);
    const sentPrev = avgSentiment(callsPrev14);
    const posLast14 = callsLast14.filter(c => c.sentiment?.toLowerCase() === "positive").length;
    const negLast14 = callsLast14.filter(c => c.sentiment?.toLowerCase() === "negative").length;

    const sentPct = sentPrev > 0 ? Math.round(((sentLast - sentPrev) / sentPrev) * 100) : null;
    const cls: TrendClassification = callsLast14.length === 0 ? "Stable"
      : sentLast > sentPrev + 0.2 ? "Growing"
      : sentLast < sentPrev - 0.2 ? "Declining"
      : "Stable";

    if (callsLast14.length > 0) {
      signals.push({
        signalType:   "call_sentiment_trend",
        label:        "Call Sentiment Quality",
        classification: cls,
        currentValue: Math.round(sentLast * 10) / 10,
        previousValue: Math.round(sentPrev * 10) / 10,
        changePercent: sentPct,
        insight:      `${posLast14} positive, ${negLast14} negative calls in last 14 days (${callsLast14.length} total). Avg sentiment score ${Math.round(sentLast * 10) / 10}/3.`,
        actionHint:   negLast14 > posLast14
          ? "More negative than positive calls — review agent scripts, qualify leads more tightly, and update objection-handling flows."
          : cls === "Growing"
          ? "Call sentiment improving — identify what's working and replicate across all agents."
          : "Call sentiment stable — A/B test opening scripts to push positive rate above 60%.",
        computedAt: ts,
      });
    }
  }

  // ── 10. WhatsApp Reply Rate ────────────────────────────────────────────────
  // Measures conversation engagement (replies to outbound messages)
  {
    const waOutLast30 = waAll.filter(m => m.direction === "outbound" && m.created_at >= s30).length;
    const waInLast30  = waAll.filter(m => m.direction === "inbound"  && m.created_at >= s30).length;
    const waOutPrev30 = waAll.filter(m => m.direction === "outbound" && m.created_at >= s60 && m.created_at < s30).length;
    const waInPrev30  = waAll.filter(m => m.direction === "inbound"  && m.created_at >= s60 && m.created_at < s30).length;

    const replyRateLast = waOutLast30 > 0 ? Math.round((waInLast30 / waOutLast30) * 100) : 0;
    const replyRatePrev = waOutPrev30 > 0 ? Math.round((waInPrev30 / waOutPrev30) * 100) : 0;

    if (waOutLast30 > 0 || waOutPrev30 > 0) {
      const cls = classify(replyRateLast, replyRatePrev);
      signals.push({
        signalType:   "whatsapp_reply_rate",
        label:        "WhatsApp Reply Rate",
        classification: cls,
        currentValue: replyRateLast,
        previousValue: replyRatePrev,
        changePercent: pctChange(replyRateLast, replyRatePrev),
        insight:      `${replyRateLast}% reply rate this month (${waInLast30} replies / ${waOutLast30} sent) vs ${replyRatePrev}% prior month.`,
        actionHint:   replyRateLast < 10
          ? "Low reply rate — test personalised opening messages, timing variations (9am or 6pm), and shorter initial messages."
          : replyRateLast < 30
          ? "Moderate reply rate — add a clear question or CTA in your first message to increase engagement."
          : "Strong reply rate — focus on increasing outreach volume to maximise pipeline impact.",
        computedAt: ts,
      });
    }
  }

  // ── 11. Email Campaign Engagement ─────────────────────────────────────────
  // Tracks HexMail enrollment activity and campaign completion rates
  {
    const enrolLast30 = enrollments.filter(e => e.enrolled_at >= s30).length;
    const enrolPrev30 = enrollments.filter(e => e.enrolled_at >= s60 && e.enrolled_at < s30).length;
    const completedLast30 = enrollments.filter(e => e.status === "completed" && e.enrolled_at >= s30).length;
    const activeCampaigns = hexmail.filter(c => c.status === "active").length;

    if (enrolLast30 > 0 || enrolPrev30 > 0 || activeCampaigns > 0) {
      const cls = classify(enrolLast30, enrolPrev30);
      const completionRate = enrolLast30 > 0 ? Math.round((completedLast30 / enrolLast30) * 100) : 0;
      signals.push({
        signalType:   "email_campaign_engagement",
        label:        "Email Campaign Engagement",
        classification: cls,
        currentValue: enrolLast30,
        previousValue: enrolPrev30,
        changePercent: pctChange(enrolLast30, enrolPrev30),
        insight:      `${enrolLast30} email sequence enrolments this month (${completedLast30} completed, ${completionRate}% completion). ${activeCampaigns} active HexMail campaign(s).`,
        actionHint:   enrolLast30 === 0
          ? "No email enrolments this month — add leads to HexMail sequences to start nurturing your pipeline."
          : completionRate < 30
          ? "Low sequence completion — shorten sequences, reduce email cadence, or review content relevance."
          : cls === "Growing"
          ? "Email enrolments growing — excellent nurture channel. Scale by enrolling more leads automatically."
          : "Email engagement stable — introduce A/B testing on subject lines to push completion rates higher.",
        computedAt: ts,
      });
    }
  }

  // ── 12. Campaign Performance Delta ────────────────────────────────────────
  // Tracks the number of active vs. historical campaigns (as a growth proxy)
  {
    const campaignsLast30 = campaigns.filter(c => c.created_at >= s30).length;
    const campaignsPrev30 = campaigns.filter(c => c.created_at >= s60 && c.created_at < s30).length;
    const activeCampaignCount = campaigns.filter(c => c.status === "active").length;

    if (campaigns.length > 0) {
      const cls = campaignsLast30 > campaignsPrev30 ? "Growing"
                : campaignsLast30 < campaignsPrev30 ? "Declining"
                : activeCampaignCount > 0 ? "Stable" : "Declining";
      signals.push({
        signalType:   "campaign_performance_delta",
        label:        "Campaign Activity Delta",
        classification: cls,
        currentValue: campaignsLast30,
        previousValue: campaignsPrev30,
        changePercent: pctChange(campaignsLast30, campaignsPrev30),
        insight:      `${campaignsLast30} campaign(s) created this month vs ${campaignsPrev30} last month. ${activeCampaignCount} currently active.`,
        actionHint:   activeCampaignCount === 0
          ? "No active campaigns — launch a campaign from Campaign Factory to start generating leads."
          : cls === "Declining"
          ? "Campaign creation slowing — schedule at least one new campaign per month to maintain pipeline health."
          : cls === "Growing"
          ? "Campaign activity accelerating — review performance metrics and double down on highest-ROI campaigns."
          : "Campaign volume stable — optimise existing campaigns before launching new ones.",
        computedAt: ts,
      });
    }
  }

  return signals;
}

// ── Server functions ───────────────────────────────────────────────────────────

export const getTrendSignals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    try {
      const { data } = await sb
        .from("growthmind_trend_signals")
        .select("id, signal_type, label, classification, current_value, previous_value, change_percent, insight, action_hint, computed_at")
        .eq("workspace_id", workspaceId)
        .order("computed_at", { ascending: false })
        .limit(30);

      const signals: TrendSignal[] = (data ?? []).map((r: any) => ({
        id:             r.id,
        signalType:     r.signal_type,
        label:          r.label,
        classification: r.classification as TrendClassification,
        currentValue:   r.current_value,
        previousValue:  r.previous_value,
        changePercent:  r.change_percent,
        insight:        r.insight,
        actionHint:     r.action_hint,
        computedAt:     r.computed_at,
      }));
      return { signals };
    } catch {
      return { signals: [] };
    }
  });

export const runTrendEngine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const signals = await detectTrendSignals(sb, workspaceId);

    await sb.from("growthmind_trend_signals").delete().eq("workspace_id", workspaceId).catch(() => {});

    const rows = signals.map(s => ({
      workspace_id:   workspaceId,
      signal_type:    s.signalType,
      label:          s.label,
      classification: s.classification,
      current_value:  s.currentValue,
      previous_value: s.previousValue,
      change_percent: s.changePercent,
      insight:        s.insight,
      action_hint:    s.actionHint,
      computed_at:    s.computedAt,
    }));

    await sb.from("growthmind_trend_signals").insert(rows).catch(() => {});
    return { ok: true, count: signals.length, signals };
  });
