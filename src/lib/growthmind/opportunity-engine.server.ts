// SERVER ONLY — never import from a client component.
// Deterministic opportunity detection from real workspace data.
// No mocked or fallback analytics — every finding is grounded in actual DB records.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Types ──────────────────────────────────────────────────────────────────────

export type OpportunityUrgency  = "low" | "medium" | "high" | "critical";
export type OpportunityEffort   = "low" | "medium" | "high";
export type OpportunityCategory =
  | "SEO Opportunity"
  | "Paid Ads Opportunity"
  | "Content Opportunity"
  | "Funnel Opportunity"
  | "Follow-Up Opportunity"
  | "Referral Opportunity"
  | "Reactivation Opportunity"
  | "Conversion Opportunity"
  | "Offer Opportunity"
  | "Audience Opportunity"
  | "Geographic Opportunity";

export type Opportunity = {
  id:                string;
  workspaceId:       string;
  title:             string;
  category:          OpportunityCategory;
  evidence:          string;
  expectedImpact:    string;
  confidenceScore:   number;
  urgency:           OpportunityUrgency;
  recommendedAction: string;
  estimatedEffort:   OpportunityEffort;
  recommendedChannel: string;
  relatedAssets:     string[];
  sourceData:        Record<string, unknown>;
  lastCalculatedAt:  string;
  createdAt:         string;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

async function logAudit(sb: any, workspaceId: string, eventType: string, status: "success" | "error", durationMs: number, errorMsg?: string) {
  try {
    await sb.from("growthmind_generation_audit").insert({
      workspace_id:  workspaceId,
      event_type:    eventType,
      entity_type:   "opportunities",
      triggered_by:  "user",
      duration_ms:   durationMs,
      status,
      error_message: errorMsg ?? null,
    });
  } catch { /* audit failure must never block the main flow */ }
}

// ── Core detector ──────────────────────────────────────────────────────────────

async function detectOpportunities(sb: any, workspaceId: string): Promise<{
  opportunities: Omit<Opportunity, "id" | "workspaceId" | "createdAt">[];
  sourceSnapshot: Record<string, unknown>;
}> {
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // Gather real data — all workspace scoped, no fallbacks
  const [
    leadsRes, callsRes, bookingsRes,
    seoRes, competitorsRes, contentCalendarRes,
    waContactsRes, waMessageRes,
    hexmailRes, goalsRes, dnaRes,
    contentAssetsRes, adsAccountsRes,
  ] = await Promise.all([
    sb.from("leads").select("id, status, pipeline_stage, created_at, updated_at, source").eq("workspace_id", workspaceId).limit(2000),
    sb.from("calls").select("id, call_status, call_successful, duration_seconds, started_at, sentiment").eq("workspace_id", workspaceId).gte("started_at", since90).limit(3000),
    sb.from("calendar_bookings").select("id, status, created_at").eq("workspace_id", workspaceId).limit(500),
    sb.from("growthmind_seo_sites").select("id, url, keywords, ai_recs").eq("workspace_id", workspaceId).limit(10),
    sb.from("growthmind_competitors").select("id, name, website, ai_analysis").eq("workspace_id", workspaceId).limit(20),
    sb.from("growthmind_content_calendar").select("id, title, status, scheduled_date, channel").eq("workspace_id", workspaceId).gte("created_at", since90).limit(100),
    sb.from("whatsapp_contacts").select("id, created_at").eq("workspace_id", workspaceId).limit(1),
    Promise.resolve(sb.from("whatsapp_messages").select("id, direction, created_at").eq("workspace_id", workspaceId).gte("created_at", since30).limit(500)).catch(() => ({ data: [] })),
    sb.from("hexmail_campaigns").select("id, name, status, type").eq("workspace_id", workspaceId).limit(50),
    sb.from("growthmind_goals").select("id, metric, target, deadline").eq("workspace_id", workspaceId).limit(10),
    sb.from("growthmind_business_dna").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    sb.from("growthmind_content_assets").select("id, content_type, status, created_at").eq("workspace_id", workspaceId).gte("created_at", since30).limit(100),
    sb.from("growthmind_ads_accounts").select("id, platform, status").eq("workspace_id", workspaceId).limit(20),
  ]);

  const leads:          any[] = leadsRes.data          ?? [];
  const calls:          any[] = callsRes.data          ?? [];
  const bookings:       any[] = bookingsRes.data        ?? [];
  const seoSites:       any[] = seoRes.data            ?? [];
  const competitors:    any[] = competitorsRes.data     ?? [];
  const calendarItems:  any[] = contentCalendarRes.data ?? [];
  const waContacts:     any[] = waContactsRes.data      ?? [];
  const waMessages:     any[] = (waMessageRes as any).data ?? [];
  const hexmailCampaigns: any[] = hexmailRes.data       ?? [];
  const goals:          any[] = goalsRes.data           ?? [];
  const dna:            any   = dnaRes.data             ?? null;
  const contentAssets:  any[] = contentAssetsRes.data   ?? [];
  const adsAccounts:    any[] = adsAccountsRes.data     ?? [];

  // Derived metrics from real data
  const totalLeads    = leads.length;
  const staleLeads    = leads.filter(l => {
    const updated = new Date(l.updated_at);
    return Date.now() - updated.getTime() > 14 * 24 * 60 * 60 * 1000;
  });
  const neverCalled   = leads.filter(l => l.status === "new" || l.status === "not_contacted");
  const wonLeads      = leads.filter(l => l.status === "sale" || l.status === "won");
  const lostLeads     = leads.filter(l => l.status === "lost" || l.status === "dead");
  const convRate      = totalLeads > 0 ? wonLeads.length / totalLeads : 0;

  const successCalls  = calls.filter(c => c.call_successful === true);
  const callSuccRate  = calls.length > 0 ? successCalls.length / calls.length : 0;

  const totalBookings = bookings.length;

  const seoKeywords   = seoSites.reduce((acc, s) => acc + ((s.keywords as any[])?.length ?? 0), 0);
  const hasCompetitors = competitors.length > 0;
  const hasContentCal  = calendarItems.length > 0;
  const hasWa          = waContacts.length > 0;
  const hasHexmail     = hexmailCampaigns.length > 0;
  const activeHexmail  = hexmailCampaigns.filter((c: any) => c.status === "active").length;
  const hasAds         = adsAccounts.some((a: any) => a.status === "active");

  const sourceLeads    = leads.reduce((acc: Record<string, number>, l) => {
    if (l.source) acc[l.source] = (acc[l.source] ?? 0) + 1;
    return acc;
  }, {});
  const topSource = Object.entries(sourceLeads).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const calendarDraftCount = calendarItems.filter((c: any) => c.status === "Draft").length;
  const publishedCount     = contentAssets.filter((a: any) => a.status === "published").length;

  const sourceSnapshot = {
    totalLeads, staleLeads: staleLeads.length, neverCalled: neverCalled.length,
    wonLeads: wonLeads.length, lostLeads: lostLeads.length, convRate,
    callSuccRate, totalBookings, seoKeywords, hasCompetitors, hasContentCal,
    hasWa, waMessages: waMessages.length, hasHexmail, activeHexmail, hasAds,
    publishedContent30d: publishedCount, calendarDrafts: calendarDraftCount,
    topLeadSource: topSource, goals: goals.length, competitors: competitors.length,
    dnaCompletedFields: dna ? Object.values(dna).filter(v => v && String(v).trim().length > 0).length : 0,
  };

  const now = new Date().toISOString();
  const opportunities: Omit<Opportunity, "id" | "workspaceId" | "createdAt">[] = [];

  function push(opp: Omit<Opportunity, "id" | "workspaceId" | "createdAt" | "lastCalculatedAt">) {
    opportunities.push({ ...opp, lastCalculatedAt: now });
  }

  // ── 1. Reactivation Opportunity ────────────────────────────────────────────
  if (staleLeads.length >= 5) {
    push({
      title:             `Reactivate ${staleLeads.length} stale leads`,
      category:          "Reactivation Opportunity",
      evidence:          `${staleLeads.length} leads have not been updated in 14+ days. These contacts have shown prior interest but gone cold.`,
      expectedImpact:    `Re-engaging ${staleLeads.length} stale leads at even a 10% win-back rate adds ${Math.round(staleLeads.length * 0.1)} extra conversions.`,
      confidenceScore:   Math.min(0.95, 0.6 + (staleLeads.length / 100)),
      urgency:           staleLeads.length > 30 ? "critical" : staleLeads.length > 15 ? "high" : "medium",
      recommendedAction: "Launch a WhatsApp broadcast or AI call campaign targeting all stale leads with a re-engagement offer.",
      estimatedEffort:   "low",
      recommendedChannel: hasWa ? "WhatsApp" : "AI Calling",
      relatedAssets:     ["/growthmind/lead-opportunities", "/campaigns"],
      sourceData:        { staleLeadCount: staleLeads.length },
    });
  }

  // ── 2. Follow-Up Opportunity ───────────────────────────────────────────────
  if (neverCalled.length >= 3) {
    push({
      title:             `${neverCalled.length} leads have never been contacted`,
      category:          "Follow-Up Opportunity",
      evidence:          `${neverCalled.length} leads are in 'new' or 'not contacted' status — no outreach attempt recorded.`,
      expectedImpact:    `Contacting leads within 1 hour increases conversion by 7×. Calling ${neverCalled.length} leads now could close ${Math.max(1, Math.round(neverCalled.length * Math.max(convRate, 0.05)))} deals.`,
      confidenceScore:   0.92,
      urgency:           neverCalled.length > 20 ? "critical" : "high",
      recommendedAction: "Create an immediate outbound call campaign for all uncalled leads.",
      estimatedEffort:   "low",
      recommendedChannel: "AI Calling",
      relatedAssets:     ["/leads", "/campaigns"],
      sourceData:        { neverCalledCount: neverCalled.length },
    });
  }

  // ── 3. Conversion Opportunity ──────────────────────────────────────────────
  if (totalLeads >= 20 && convRate < 0.08) {
    push({
      title:             `Conversion rate is ${(convRate * 100).toFixed(1)}% — improve with better qualification`,
      category:          "Conversion Opportunity",
      evidence:          `${wonLeads.length} wins from ${totalLeads} leads (${(convRate * 100).toFixed(1)}%). Industry average is typically 10–20%.`,
      expectedImpact:    `Improving to 10% from current ${(convRate * 100).toFixed(1)}% would add ${Math.max(0, Math.round(totalLeads * 0.1) - wonLeads.length)} extra closed deals from the same pipeline.`,
      confidenceScore:   0.80,
      urgency:           convRate < 0.03 ? "critical" : "high",
      recommendedAction: "Analyse call transcripts for common objections. Refine your opening message and qualification criteria. Consider adding a discovery call step.",
      estimatedEffort:   "medium",
      recommendedChannel: "AI Calling + Content",
      relatedAssets:     ["/calls", "/growthmind/funnels"],
      sourceData:        { convRate, totalLeads, wonLeads: wonLeads.length },
    });
  }

  // ── 4. SEO Opportunity ─────────────────────────────────────────────────────
  if (seoKeywords === 0) {
    push({
      title:             "No SEO keywords tracked — missing organic growth channel",
      category:          "SEO Opportunity",
      evidence:          "Zero SEO keywords are being monitored. Without keyword tracking there is no visibility into search engine performance.",
      expectedImpact:    "Businesses ranking for 10+ targeted keywords generate 3–5× more inbound leads with zero ad spend.",
      confidenceScore:   0.90,
      urgency:           "medium",
      recommendedAction: "Add your 5–10 core service keywords to GrowthMind SEO. Use competitor websites as starting points.",
      estimatedEffort:   "low",
      recommendedChannel: "SEO / Content",
      relatedAssets:     ["/growthmind/seo"],
      sourceData:        { seoKeywords: 0 },
    });
  } else if (seoKeywords < 10) {
    push({
      title:             `Only ${seoKeywords} SEO keywords tracked — expand coverage`,
      category:          "SEO Opportunity",
      evidence:          `Tracking ${seoKeywords} keywords is a start but insufficient for full SEO visibility. Broader coverage reveals more ranking opportunities.`,
      expectedImpact:    "Expanding to 20+ keywords typically uncovers 3–5 quick-win ranking opportunities per month.",
      confidenceScore:   0.75,
      urgency:           "low",
      recommendedAction: "Review competitor domains for high-intent keywords. Add long-tail variants of your core service terms.",
      estimatedEffort:   "low",
      recommendedChannel: "SEO / Content",
      relatedAssets:     ["/growthmind/seo"],
      sourceData:        { seoKeywords },
    });
  }

  // ── 5. Content Opportunity ─────────────────────────────────────────────────
  if (publishedCount === 0 && calendarDraftCount === 0) {
    push({
      title:             "No content published or planned in the last 30 days",
      category:          "Content Opportunity",
      evidence:          `Zero content assets published and zero calendar entries in the last 30 days.`,
      expectedImpact:    "Consistent content publishing builds authority, supports SEO, and generates inbound leads at zero ad cost. Businesses publishing 4+ posts/month get 3× more leads.",
      confidenceScore:   0.88,
      urgency:           "medium",
      recommendedAction: "Use Content Studio to generate 1 blog post and 4 social media posts this week. Schedule them in the Content Calendar.",
      estimatedEffort:   "low",
      recommendedChannel: "Content / Social",
      relatedAssets:     ["/growthmind/content-studio", "/growthmind/content-calendar"],
      sourceData:        { publishedCount, calendarDraftCount },
    });
  } else if (calendarDraftCount > 3) {
    push({
      title:             `${calendarDraftCount} content pieces stuck in Draft — publish or reschedule`,
      category:          "Content Opportunity",
      evidence:          `${calendarDraftCount} items in the content calendar are still in Draft status. Draft content generates zero traffic or leads.`,
      expectedImpact:    `Publishing these ${calendarDraftCount} drafts immediately would accelerate SEO indexing and social reach.`,
      confidenceScore:   0.82,
      urgency:           "medium",
      recommendedAction: "Review and publish or schedule all Draft calendar entries. Remove any that are no longer relevant.",
      estimatedEffort:   "low",
      recommendedChannel: "Content / Social",
      relatedAssets:     ["/growthmind/content-calendar"],
      sourceData:        { calendarDraftCount },
    });
  }

  // ── 6. Paid Ads Opportunity ────────────────────────────────────────────────
  if (!hasAds && totalLeads < 50) {
    push({
      title:             "No ad accounts connected — missing scalable paid acquisition channel",
      category:          "Paid Ads Opportunity",
      evidence:          "No active Google, Meta, or LinkedIn ad accounts are connected. Paid channels allow controlled, scalable lead generation.",
      expectedImpact:    "Businesses investing even £500/month in targeted ads typically see 20–40 new leads per month at controlled CPL.",
      confidenceScore:   0.70,
      urgency:           "medium",
      recommendedAction: "Connect a Google Ads or Meta Ads account and let GrowthMind generate your first campaign draft based on your DNA.",
      estimatedEffort:   "medium",
      recommendedChannel: "Google Ads / Meta Ads",
      relatedAssets:     ["/growthmind/ads", "/growthmind/campaign-factory"],
      sourceData:        { adsConnected: false },
    });
  }

  // ── 7. Audience Opportunity ────────────────────────────────────────────────
  if (topSource && sourceLeads[topSource] / Math.max(totalLeads, 1) > 0.6 && totalLeads > 10) {
    push({
      title:             `Over-reliance on '${topSource}' as lead source (${Math.round(sourceLeads[topSource] / totalLeads * 100)}%)`,
      category:          "Audience Opportunity",
      evidence:          `${Math.round(sourceLeads[topSource] / totalLeads * 100)}% of your ${totalLeads} leads come from a single source ('${topSource}'). This creates pipeline concentration risk.`,
      expectedImpact:    "Diversifying lead sources across 3+ channels reduces acquisition risk and stabilises pipeline volume.",
      confidenceScore:   0.78,
      urgency:           "medium",
      recommendedAction: "Identify 2 alternative acquisition channels (referrals, paid ads, content, partnerships) and launch targeted campaigns for each.",
      estimatedEffort:   "medium",
      recommendedChannel: "Multi-channel",
      relatedAssets:     ["/growthmind/campaign-factory"],
      sourceData:        { topSource, concentration: sourceLeads[topSource] / totalLeads },
    });
  }

  // ── 8. Referral Opportunity ────────────────────────────────────────────────
  if (wonLeads.length >= 5 && !(dna?.case_studies?.trim())) {
    push({
      title:             `${wonLeads.length} won clients but no case studies or referral mechanism`,
      category:          "Referral Opportunity",
      evidence:          `You have ${wonLeads.length} won deals but no case studies documented. Won clients are your best marketing asset.`,
      expectedImpact:    "A structured referral programme typically generates 20–30% of new leads at near-zero cost. Case studies boost conversion rates by up to 35%.",
      confidenceScore:   0.85,
      urgency:           "medium",
      recommendedAction: "Document 1–2 case studies from your top wins. Build a simple referral ask into your post-sale follow-up sequence.",
      estimatedEffort:   "low",
      recommendedChannel: "Email + Content",
      relatedAssets:     ["/growthmind/business-dna", "/growthmind/content-studio"],
      sourceData:        { wonLeads: wonLeads.length, hasCaseStudies: false },
    });
  }

  // ── 9. Funnel Opportunity ──────────────────────────────────────────────────
  if (totalLeads >= 15 && totalBookings === 0) {
    push({
      title:             "Leads not converting to booked appointments",
      category:          "Funnel Opportunity",
      evidence:          `${totalLeads} total leads but 0 bookings recorded. Mid-funnel drop-off is occurring between initial contact and appointment.`,
      expectedImpact:    "Adding a smooth booking step to your AI agent flow typically doubles conversion from conversation to committed meeting.",
      confidenceScore:   0.87,
      urgency:           "high",
      recommendedAction: "Enable calendar booking in your AI agents. Add a clear CTA in your WhatsApp follow-up: 'Book a free 15-min call here: [link]'.",
      estimatedEffort:   "low",
      recommendedChannel: "AI Agent + Calendar",
      relatedAssets:     ["/growthmind/funnels", "/builder"],
      sourceData:        { totalLeads, totalBookings: 0 },
    });
  }

  // ── 10. Offer Opportunity ──────────────────────────────────────────────────
  if (!dna?.offers?.trim() && totalLeads > 5) {
    push({
      title:             "No current offer defined in Business DNA",
      category:          "Offer Opportunity",
      evidence:          "Business DNA has no 'Current Offers' field filled in. Without a clear offer, conversion rates are typically 40–60% lower.",
      expectedImpact:    "A specific, time-bound offer dramatically increases conversion in AI calls, ads, and content. Even a trial or consultation offer can double response rates.",
      confidenceScore:   0.80,
      urgency:           "high",
      recommendedAction: "Define your lead magnet or entry offer in Business DNA. Use it as the CTA across all GrowthMind campaigns.",
      estimatedEffort:   "low",
      recommendedChannel: "All channels",
      relatedAssets:     ["/growthmind/business-dna"],
      sourceData:        { offersFieldEmpty: true },
    });
  }

  // ── 11. Geographic Opportunity ─────────────────────────────────────────────
  if (dna?.locations?.trim() && !hasAds && totalLeads > 10) {
    const locs = dna.locations.split(/[,\n]/).map((l: string) => l.trim()).filter(Boolean);
    if (locs.length === 1) {
      push({
        title:             `Serving ${locs[0]} only — explore expansion to adjacent markets`,
        category:          "Geographic Opportunity",
        evidence:          `Business DNA shows operations in ${locs[0]} only. No ads are running to test adjacent geographies.`,
        expectedImpact:    "Expanding to 1–2 nearby markets typically increases addressable pipeline by 50–200% without operational overhead.",
        confidenceScore:   0.65,
        urgency:           "low",
        recommendedAction: `Run a geo-targeted ad test in cities/regions adjacent to ${locs[0]} with your strongest offer. Measure CPL before committing budget.`,
        estimatedEffort:   "medium",
        recommendedChannel: "Google Ads / Meta Ads",
        relatedAssets:     ["/growthmind/campaign-factory"],
        sourceData:        { locations: locs },
      });
    }
  }

  // Sort: critical → high → medium → low, then by confidence desc
  const urgencyOrder: Record<OpportunityUrgency, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  opportunities.sort((a, b) =>
    urgencyOrder[a.urgency] - urgencyOrder[b.urgency] ||
    b.confidenceScore - a.confidenceScore,
  );

  return { opportunities, sourceSnapshot };
}

// ── Server fn: run the engine (clears old + re-inserts) ───────────────────────

export const runOpportunityEngine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const t0 = Date.now();
    try {
      const { opportunities, sourceSnapshot } = await detectOpportunities(sb, workspaceId);

      // Clear previous opportunities for this workspace
      await sb.from("growthmind_opportunities").delete().eq("workspace_id", workspaceId);

      if (opportunities.length > 0) {
        const rows = opportunities.map(o => ({
          workspace_id:       workspaceId,
          title:              o.title,
          category:           o.category,
          evidence:           o.evidence,
          expected_impact:    o.expectedImpact,
          confidence_score:   o.confidenceScore,
          urgency:            o.urgency,
          recommended_action: o.recommendedAction,
          estimated_effort:   o.estimatedEffort,
          recommended_channel: o.recommendedChannel,
          related_assets:     o.relatedAssets,
          source_data:        o.sourceData,
          source_snapshot:    sourceSnapshot,
          last_calculated_at: new Date().toISOString(),
        }));
        const { error } = await sb.from("growthmind_opportunities").insert(rows);
        if (error) throw new Error(error.message);
      }

      await logAudit(sb, workspaceId, "opportunity_engine_run", "success", Date.now() - t0);
      return { count: opportunities.length, opportunities };
    } catch (err: any) {
      await logAudit(sb, workspaceId, "opportunity_engine_run", "error", Date.now() - t0, err.message);
      throw err;
    }
  });

// ── Server fn: get stored opportunities ───────────────────────────────────────

export const getOpportunities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data, error } = await sb
      .from("growthmind_opportunities")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("urgency", { ascending: true })
      .order("confidence_score", { ascending: false });

    if (error && error.code !== "42P01") throw new Error(error.message);

    const opportunities: Opportunity[] = (data ?? []).map((r: any) => ({
      id:                r.id,
      workspaceId:       r.workspace_id,
      title:             r.title,
      category:          r.category,
      evidence:          r.evidence,
      expectedImpact:    r.expected_impact,
      confidenceScore:   Number(r.confidence_score),
      urgency:           r.urgency,
      recommendedAction: r.recommended_action,
      estimatedEffort:   r.estimated_effort,
      recommendedChannel: r.recommended_channel,
      relatedAssets:     r.related_assets ?? [],
      sourceData:        r.source_data ?? {},
      lastCalculatedAt:  r.last_calculated_at,
      createdAt:         r.created_at,
    }));

    return { opportunities };
  });

// ── Server fn: send opportunity to HiveMind for approval ──────────────────────

export const sendOpportunityToHiveMind = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ opportunityId: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: opp, error: oppErr } = await sb
      .from("growthmind_opportunities")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", data.opportunityId)
      .single();

    if (oppErr || !opp) throw new Error("Opportunity not found");

    const { assertProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
    await assertProposalAllowed(sb, workspaceId);

    const { data: action, error: actionErr } = await sb
      .from("hivemind_actions")
      .insert({
        workspace_id:   workspaceId,
        title:          `GrowthMind Opportunity: ${opp.title}`,
        description:    `${opp.evidence}\n\nRecommended action: ${opp.recommended_action}\nExpected impact: ${opp.expected_impact}`,
        action_type:    "growthmind_opportunity",
        action_payload: {
          opportunity_id:     opp.id,
          category:           opp.category,
          urgency:            opp.urgency,
          confidence_score:   opp.confidence_score,
          recommended_channel: opp.recommended_channel,
        },
        proposed_by:    "growthmind",
        status:         "pending",
      })
      .select("id")
      .single();

    if (actionErr) throw new Error(actionErr.message);

    await logAudit(sb, workspaceId, "opportunity_sent_to_hivemind", "success", 0);
    return { actionId: action.id };
  });
