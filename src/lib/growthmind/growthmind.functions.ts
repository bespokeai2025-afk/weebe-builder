import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type GrowthRecommendation } from "./growthmind.recommendations";

// ── Main marketing data aggregator ─────────────────────────────────────────────
// NOTE: returns ONLY derived metrics — no raw credentials or sensitive settings.
export const getGrowthMindData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    return buildGrowthMindData(sb, workspaceId);
  });

// ── Reusable platform-data builder ─────────────────────────────────────────────
// Server-only; consumed by getGrowthMindData above and the Executive Bridge.
// Returns ONLY derived metrics — no raw credentials or sensitive settings.
export async function buildGrowthMindData(sb: any, workspaceId: string) {
    const now      = new Date();
    const since7   = new Date(now); since7.setDate(now.getDate() - 7);
    const since14  = new Date(now); since14.setDate(now.getDate() - 14);
    const since30  = new Date(now); since30.setDate(now.getDate() - 30);
    const since60  = new Date(now); since60.setDate(now.getDate() - 60);
    const since90  = new Date(now); since90.setDate(now.getDate() - 90);
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);

    const s7    = since7.toISOString();
    const s14   = since14.toISOString();
    const s30   = since30.toISOString();
    const s60   = since60.toISOString();
    const s90   = since90.toISOString();
    const today = todayStart.toISOString();

    const [
      agentsRes, callsRes, leadsRes, bookingsRes, settingsRes,
      campaignsRes, waMessagesRes, hexmailRes, telephonyRes, phoneNumsRes,
      seoSitesRes, contentAssetsRes, competitorsRes, waContactsRes,
    ] = await Promise.all([
      sb.from("agents")
        .select("id, name, retell_agent_id, inbound_phone_number, settings, created_at, updated_at")
        .eq("workspace_id", workspaceId),

      sb.from("calls")
        .select("id, agent_id, agent_name, call_status, call_successful, duration_seconds, sentiment, started_at, call_type, from_number, to_number")
        .eq("workspace_id", workspaceId)
        .gte("started_at", s90)
        .order("started_at", { ascending: false })
        .limit(5000),

      sb.from("leads")
        .select("id, status, pipeline_stage, updated_at, created_at, full_name, name, phone, email, source")
        .eq("workspace_id", workspaceId)
        .limit(5000),

      sb.from("calendar_bookings")
        .select("id, agent_id, status, created_at, title, attendee_name, attendee_email, start_at")
        .eq("workspace_id", workspaceId)
        .limit(1000),

      // Marketing-relevant settings only — no infrastructure keys
      sb.from("workspace_settings")
        .select("calcom_api_key, whatsapp_phone_id")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),

      sb.from("call_campaigns")
        .select("id, name, status, total_leads, completed_calls, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .limit(200),

      sb.from("whatsapp_messages")
        .select("id, direction, created_at, status, body, contact_name, contact_phone")
        .eq("workspace_id", workspaceId)
        .gte("created_at", s30)
        .limit(1000),

      sb.from("hexmail_campaigns")
        .select("id, name, status, type, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .limit(100),

      sb.from("telephony_calls")
        .select("id, direction, status, duration, created_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", s30)
        .limit(500),

      sb.from("phone_numbers")
        .select("id, phone_number, agent_id, active, created_at")
        .eq("workspace_id", workspaceId)
        .limit(50),

      // Marketing intelligence data
      sb.from("growthmind_seo_sites")
        .select("id, keywords")
        .eq("workspace_id", workspaceId)
        .limit(20),

      sb.from("growthmind_content_assets")
        .select("id, content_type, status, created_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", since14.toISOString())
        .limit(200),

      sb.from("growthmind_competitors")
        .select("id, name")
        .eq("workspace_id", workspaceId)
        .limit(50),

      sb.from("whatsapp_contacts")
        .select("id, created_at")
        .eq("workspace_id", workspaceId)
        .limit(1)
        .maybeSingle(),
    ]);

    // Ads campaign metrics — reads from growthmind_ad_campaigns (dedicated ads table).
    // Scoped to last 30 days (synced_at) and requires synced_at IS NOT NULL to exclude stale rows.
    // Falls back gracefully if the ADS_ANALYTICS_MIGRATION hasn't been applied yet.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const adsCampaignsRes = await Promise.resolve(
      sb.from("growthmind_ad_campaigns")
        .select("id,platform,name,status,spend,impressions,clicks,conversions,roas,revenue,synced_at,date_start,date_end")
        .eq("workspace_id", workspaceId)
        .not("synced_at", "is", null)
        .gte("synced_at", thirtyDaysAgo)
        .order("spend", { ascending: false })
        .limit(200),
    ).catch(() => ({ data: [] }));

    const adsCampaigns: any[] = adsCampaignsRes.data ?? [];

    // Aggregate by platform
    const metaCamps   = adsCampaigns.filter(c => c.platform === "meta");
    const googleCamps = adsCampaigns.filter(c => c.platform === "google");

    function adsTotals(camps: any[]) {
      const totalSpend       = +camps.reduce((a, c) => a + Number(c.spend   ?? 0), 0).toFixed(2);
      const totalImpressions =  camps.reduce((a, c) => a + Number(c.impressions ?? 0), 0);
      const totalClicks      =  camps.reduce((a, c) => a + Number(c.clicks   ?? 0), 0);
      const totalConversions =  camps.reduce((a, c) => a + Number(c.conversions ?? 0), 0);
      const totalRevenue     =  camps.reduce((a, c) => a + Number((c as any).revenue ?? 0), 0);
      const activeCampaigns  =  camps.filter(c => c.status === "active").length;

      // Blended ROAS: total revenue / total spend (more accurate than avg of per-campaign ROAS)
      const blendedRoas = totalSpend > 0 && totalRevenue > 0
        ? +(totalRevenue / totalSpend).toFixed(3) : null;

      // Average CPL: total spend / total conversions
      const avgCpl = totalConversions > 0
        ? +(totalSpend / totalConversions).toFixed(2) : null;

      return {
        count:          camps.length,
        activeCampaigns,
        spend:          totalSpend,
        impressions:    totalImpressions,
        clicks:         totalClicks,
        conversions:    totalConversions,
        revenue:        +totalRevenue.toFixed(2),
        blendedRoas,
        avgCpl,
        // Legacy field: per-campaign avgRoas (weighted mean)
        avgRoas:        blendedRoas,
        ctr: totalImpressions > 0
          ? +(totalClicks / totalImpressions * 100).toFixed(2) : null,
        lastSyncedAt: camps.reduce((latest: string | null, c) => {
          if (!c.synced_at) return latest;
          if (!latest) return c.synced_at;
          return c.synced_at > latest ? c.synced_at : latest;
        }, null),
      };
    }

    const totalAdSpend   = +adsCampaigns.reduce((a, c) => a + Number(c.spend   ?? 0), 0).toFixed(2);
    const totalAdRevenue =  adsCampaigns.reduce((a, c) => a + Number((c as any).revenue ?? 0), 0);
    const blendedRoasAll = totalAdSpend > 0 && totalAdRevenue > 0
      ? +(totalAdRevenue / totalAdSpend).toFixed(3) : null;

    // Best / worst platform by CPL (lower CPL = better)
    const metaTotals   = adsTotals(metaCamps);
    const googleTotals = adsTotals(googleCamps);
    let bestPlatformByCpl:  "meta" | "google" | null = null;
    let worstPlatformByCpl: "meta" | "google" | null = null;
    if (metaTotals.avgCpl !== null && googleTotals.avgCpl !== null) {
      bestPlatformByCpl  = metaTotals.avgCpl <= googleTotals.avgCpl ? "meta" : "google";
      worstPlatformByCpl = bestPlatformByCpl === "meta" ? "google" : "meta";
    }

    const agents: any[]          = agentsRes.data          ?? [];
    const calls: any[]           = callsRes.data           ?? [];
    const leads: any[]           = leadsRes.data           ?? [];
    const bookings: any[]        = bookingsRes.data        ?? [];
    const settings: any          = settingsRes.data        ?? {};
    const campaigns: any[]       = campaignsRes.data       ?? [];
    const waMessages: any[]      = waMessagesRes.data      ?? [];
    const hexmailCampaigns: any[]= hexmailRes.data         ?? [];
    const telephonyCalls: any[]  = telephonyRes.data       ?? [];
    const phoneNumbers: any[]    = phoneNumsRes.data       ?? [];
    const seoSites: any[]        = seoSitesRes.data        ?? [];
    const recentContent: any[]   = contentAssetsRes.data   ?? [];
    const competitors: any[]     = competitorsRes.data     ?? [];

    // Derived marketing intelligence flags
    const totalSeoKeywords = seoSites.reduce((acc: number, s: any) => {
      const kw = s.keywords;
      if (Array.isArray(kw)) return acc + kw.length;
      if (typeof kw === "string") {
        try { const arr = JSON.parse(kw); return acc + (Array.isArray(arr) ? arr.length : 0); }
        catch { return acc; }
      }
      return acc;
    }, 0);
    const recentContentCount = recentContent.length;
    const competitorsCount   = competitors.length;
    const hasWaContacts      = !!waContactsRes.data;

    // ── CALLS ────────────────────────────────────────────────────────────────
    const calls30   = calls.filter(c => c.started_at >= s30);
    const totalCalls      = calls30.length;
    const successCalls    = calls30.filter(c => c.call_successful === true).length;
    const successRate     = totalCalls > 0 ? Math.round((successCalls / totalCalls) * 100) : 0;
    const durCalls        = calls30.filter(c => c.duration_seconds > 0);
    const avgDuration     = durCalls.length > 0
      ? Math.round(durCalls.reduce((s, c) => s + c.duration_seconds, 0) / durCalls.length) : 0;
    const inboundCalls    = calls30.filter(c => c.call_type === "inbound").length;
    const outboundCalls   = calls30.filter(c => c.call_type !== "inbound").length;
    const callsLast7      = calls30.filter(c => c.started_at >= s7).length;
    const callsToday      = calls30.filter(c => c.started_at >= today).length;

    // ── LEADS ────────────────────────────────────────────────────────────────
    const totalLeads     = leads.length;
    const needCallLeads  = leads.filter(l => l.status === "need_to_call").length;
    const staleLeads     = leads.filter(l =>
      l.status !== "sale_done" && l.status !== "do_not_call" && l.status !== "not_interested"
      && l.updated_at < s14
    );
    const saleLeads      = leads.filter(l => l.status === "sale_done").length;
    const activeLeads    = leads.filter(l =>
      l.status !== "sale_done" && l.status !== "do_not_call" && l.status !== "not_interested"
    ).length;
    const newLeads7      = leads.filter(l => l.created_at >= s7).length;
    const newLeads30     = leads.filter(l => l.created_at >= s30).length;
    const conversionRate = totalLeads > 0 ? Math.round((saleLeads / totalLeads) * 100) : 0;

    // ── FOLLOW-UP COVERAGE ────────────────────────────────────────────────────
    const calledPhones   = new Set([
      ...calls.map(c => c.from_number).filter(Boolean),
      ...calls.map(c => c.to_number).filter(Boolean),
    ]);
    const activeLeadList = leads.filter(l =>
      l.status !== "sale_done" && l.status !== "do_not_call" && l.status !== "not_interested"
    );
    const followUpCoverage = activeLeadList.length > 0
      ? Math.round((activeLeadList.filter(l => l.phone && calledPhones.has(l.phone)).length / activeLeadList.length) * 100)
      : 100;

    // ── NEVER-CALLED LEADS (for opportunities) ────────────────────────────────
    const neverCalled = activeLeadList.filter(l => l.phone && !calledPhones.has(l.phone));

    // ── LEAD RESPONSE TIME ────────────────────────────────────────────────────
    const firstCallByPhone = new Map<string, number>();
    for (const c of calls) {
      const phone = c.to_number ?? c.from_number;
      if (!phone) continue;
      const t = new Date(c.started_at).getTime();
      if (!firstCallByPhone.has(phone) || firstCallByPhone.get(phone)! > t) {
        firstCallByPhone.set(phone, t);
      }
    }
    const responseTimes: number[] = [];
    for (const l of leads.filter(l => l.phone && l.created_at >= s30)) {
      const firstCall = firstCallByPhone.get(l.phone);
      if (firstCall) {
        const hrs = (firstCall - new Date(l.created_at).getTime()) / 3_600_000;
        if (hrs >= 0 && hrs < 168) responseTimes.push(hrs);
      }
    }
    const avgResponseHrs = responseTimes.length > 0
      ? +(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length).toFixed(1)
      : null;

    // ── BOOKINGS ─────────────────────────────────────────────────────────────
    const totalBookings  = bookings.length;
    const bookings7      = bookings.filter(b => b.created_at >= s7).length;
    const agentBookings  = bookings.filter(b => b.agent_id).length;
    const bookingRate    = totalLeads > 0 ? Math.round((totalBookings / totalLeads) * 100) : 0;
    const noShowBookings = bookings.filter(b => b.status === "no_show" || b.status === "cancelled");
    const noShowDetail   = noShowBookings.slice(0, 20).map(b => ({
      id: b.id, title: b.title ?? "Appointment",
      attendeeName: b.attendee_name ?? null,
      createdAt: b.created_at, startAt: b.start_at,
    }));

    // ── CAMPAIGNS ────────────────────────────────────────────────────────────
    const activeCampaigns  = campaigns.filter(c => c.status === "running" || c.status === "active").length;
    const campaignStats = campaigns.map(c => ({
      id: c.id, name: c.name, status: c.status as string,
      totalLeads: c.total_leads ?? 0,
      completedCalls: c.completed_calls ?? 0,
      completionPct: c.total_leads > 0
        ? Math.round((c.completed_calls / c.total_leads) * 100) : 0,
      createdAt: c.created_at, updatedAt: c.updated_at,
    }));

    // ── WHATSAPP ─────────────────────────────────────────────────────────────
    const waTotal    = waMessages.length;
    const waInbound  = waMessages.filter(m => m.direction === "inbound").length;
    const waOutbound = waMessages.filter(m => m.direction === "outbound").length;

    // ── EMAIL ────────────────────────────────────────────────────────────────
    const activeEmail = hexmailCampaigns.filter(c => c.status === "active" || c.status === "running").length;

    // ── AGENT PERFORMANCE ────────────────────────────────────────────────────
    const callsPerAgent = new Map<string, any[]>();
    for (const c of calls) {
      if (!c.agent_id) continue;
      if (!callsPerAgent.has(c.agent_id)) callsPerAgent.set(c.agent_id, []);
      callsPerAgent.get(c.agent_id)!.push(c);
    }
    const phoneByAgent = new Map<string, any>();
    for (const p of phoneNumbers) {
      if (p.agent_id) phoneByAgent.set(p.agent_id, p);
    }

    const agentPerf = agents.map(a => {
      const s = (a.settings ?? {}) as Record<string, unknown>;
      const agentCalls  = callsPerAgent.get(a.id) ?? [];
      const succCnt     = agentCalls.filter(c => c.call_successful === true).length;
      const sRate       = agentCalls.length > 0 ? Math.round((succCnt / agentCalls.length) * 100) : 0;
      const deployed    = !!(s.deployedRetellAgentId || a.retell_agent_id);
      const hasPhone    = !!(s.phoneNumber || a.inbound_phone_number || phoneByAgent.has(a.id));
      const hasKB       = !!(s.knowledgeBaseId || (s.knowledgeBases as any[])?.length);
      return {
        id: a.id, name: a.name, callCount: agentCalls.length,
        successRate: sRate, deployed, hasPhone, hasKB,
        callsLast7: agentCalls.filter(c => c.started_at >= s7).length,
        lastCallAt: agentCalls[0]?.started_at ?? null,
      };
    }).sort((a, b) => b.callCount - a.callCount);

    // ── MARKETING READINESS FLAGS — marketing stack status only ─────────────
    const followUpCampaigns = hexmailCampaigns.filter((c: any) =>
      c.type === "follow_up" ||
      (c.name ?? "").toLowerCase().includes("follow") ||
      (c.name ?? "").toLowerCase().includes("nurture")
    );
    const waOutboundLast30  = waMessages.filter(m => m.direction === "outbound").length;

    const systemHealth = {
      campaigns:          campaigns.length > 0,
      activeCampaigns:    activeCampaigns > 0,
      emailCampaigns:     hexmailCampaigns.length > 0,
      followUpCampaigns:  followUpCampaigns.length > 0,
      whatsapp:           !!settings.whatsapp_phone_id,
      waOutreach:         waOutboundLast30 > 0,
      seoKeywords:        totalSeoKeywords > 0,
      recentContent:      recentContentCount > 0,
      competitors:        competitorsCount > 0,
      agents:             agents.length > 0,
      calendar:           !!settings.calcom_api_key,
    };

    // ── STALE LEAD DETAIL ─────────────────────────────────────────────────────
    const staleLeadDetail = staleLeads.slice(0, 50).map(l => ({
      id: l.id,
      name: l.full_name ?? l.name ?? "Unknown",
      status: l.status,
      pipeline_stage: l.pipeline_stage,
      daysSinceUpdate: Math.floor((Date.now() - new Date(l.updated_at).getTime()) / 86400000),
      phone: l.phone,
      email: l.email,
    }));

    // ── NEVER-CALLED DETAIL ──────────────────────────────────────────────────
    const neverCalledDetail = neverCalled.slice(0, 50).map(l => ({
      id: l.id,
      name: l.full_name ?? l.name ?? "Unknown",
      status: l.status,
      pipeline_stage: l.pipeline_stage,
      daysSinceCreated: Math.floor((Date.now() - new Date(l.created_at).getTime()) / 86400000),
      phone: l.phone,
      email: l.email,
      createdAt: l.created_at,
    }));

    // ── HOT LEADS — mid-funnel, recently updated, no booking yet ─────────────
    // "Hot" = qualified/contacted/in_progress AND updated within last 7 days
    const hotLeadStatuses = new Set(["qualified", "contacted", "in_progress", "callback_requested"]);
    const hotLeads = leads.filter(l =>
      hotLeadStatuses.has(l.status) && l.updated_at >= s7
    );
    const hotLeadDetail = hotLeads.slice(0, 30).map(l => ({
      id:              l.id,
      name:            l.full_name ?? l.name ?? "Unknown",
      status:          l.status,
      pipeline_stage:  l.pipeline_stage,
      daysSinceUpdate: Math.floor((Date.now() - new Date(l.updated_at).getTime()) / 86400000),
      phone:           l.phone,
      email:           l.email,
    }));

    // ── REPEAT-CONTACT DETAIL (called 3+ times, not converted) ───────────────
    const callCountByPhone = new Map<string, number>();
    for (const c of calls) {
      const phone = c.to_number ?? c.from_number;
      if (!phone) continue;
      callCountByPhone.set(phone, (callCountByPhone.get(phone) ?? 0) + 1);
    }
    const repeatContacts = activeLeadList.filter(l =>
      l.phone && (callCountByPhone.get(l.phone) ?? 0) >= 3
    ).slice(0, 30).map(l => ({
      id: l.id,
      name: l.full_name ?? l.name ?? "Unknown",
      status: l.status,
      phone: l.phone,
      email: l.email,
      callCount: callCountByPhone.get(l.phone) ?? 0,
    }));

    // ── STALLED PIPELINE (in_progress / qualified 7+ days no update) ─────────
    const stalledPipeline = leads.filter(l =>
      (l.status === "in_progress" || l.status === "qualified" || l.status === "contacted") &&
      l.updated_at < s7
    ).slice(0, 30).map(l => ({
      id: l.id,
      name: l.full_name ?? l.name ?? "Unknown",
      status: l.status,
      pipeline_stage: l.pipeline_stage,
      daysSinceUpdate: Math.floor((Date.now() - new Date(l.updated_at).getTime()) / 86400000),
      phone: l.phone,
      email: l.email,
    }));

    // ── TREND HELPERS ─────────────────────────────────────────────────────────
    function pctChange(curr: number, prev: number): number | null {
      if (curr === 0 && prev === 0) return null;
      if (prev === 0) return curr > 0 ? 100 : null;
      return Math.round(((curr - prev) / prev) * 100);
    }

    // Helper: cohort conversion rate for a set of leads
    function cohortConvRate(cohortLeads: any[]): number {
      if (cohortLeads.length === 0) return 0;
      const sales = cohortLeads.filter(l => l.status === "sale_done").length;
      return Math.round((sales / cohortLeads.length) * 100);
    }

    // WoW: last 7d vs prior 7d (8-14d ago)
    const wowLeadsCurr  = leads.filter(l => l.created_at >= s7);
    const wowLeadsPrev  = leads.filter(l => l.created_at >= s14 && l.created_at < s7);

    const wowCallsCurr  = calls.filter(c => c.started_at >= s7).length;
    const wowCallsPrev  = calls.filter(c => c.started_at >= s14 && c.started_at < s7).length;

    const wowCallSuccCurr  = calls.filter(c => c.started_at >= s7 && c.call_successful === true).length;
    const wowCallSuccPrev  = calls.filter(c => c.started_at >= s14 && c.started_at < s7 && c.call_successful === true).length;
    const wowCallSuccRateCurr = wowCallsCurr > 0 ? Math.round((wowCallSuccCurr / wowCallsCurr) * 100) : 0;
    const wowCallSuccRatePrev = wowCallsPrev > 0 ? Math.round((wowCallSuccPrev / wowCallsPrev) * 100) : 0;

    const wowBookCurr = bookings.filter(b => b.created_at >= s7).length;
    const wowBookPrev = bookings.filter(b => b.created_at >= s14 && b.created_at < s7).length;

    // True conversion rate deltas (cohort-based: of leads created in that window, % now sale_done)
    const wowConvRateCurr = cohortConvRate(wowLeadsCurr);
    const wowConvRatePrev = cohortConvRate(wowLeadsPrev);

    // MoM: last 30d vs prior 30d (31-60d ago)
    const momLeadsCurr  = leads.filter(l => l.created_at >= s30);
    const momLeadsPrev  = leads.filter(l => l.created_at >= s60 && l.created_at < s30);

    const momCallsCurr  = calls30.length;
    const momCallsPrev  = calls.filter(c => c.started_at >= s60 && c.started_at < s30).length;

    const momCallSuccCurr = successCalls;
    const momCallSuccPrev = calls.filter(c => c.started_at >= s60 && c.started_at < s30 && c.call_successful === true).length;
    const momCallSuccRateCurr = momCallsCurr > 0 ? Math.round((momCallSuccCurr / momCallsCurr) * 100) : 0;
    const momCallSuccRatePrev = momCallsPrev > 0 ? Math.round((momCallSuccPrev / momCallsPrev) * 100) : 0;

    const momBookCurr = bookings.filter(b => b.created_at >= s30).length;
    const momBookPrev = bookings.filter(b => b.created_at >= s60 && b.created_at < s30).length;

    // True conversion rate deltas MoM (cohort-based)
    const momConvRateCurr = cohortConvRate(momLeadsCurr);
    const momConvRatePrev = cohortConvRate(momLeadsPrev);

    const trends = {
      leads:          { wowPct: pctChange(wowLeadsCurr.length, wowLeadsPrev.length), momPct: pctChange(momLeadsCurr.length, momLeadsPrev.length) },
      calls:          { wowPct: pctChange(wowCallsCurr, wowCallsPrev),               momPct: pctChange(momCallsCurr, momCallsPrev) },
      callSuccess:    { wowPct: pctChange(wowCallSuccRateCurr, wowCallSuccRatePrev), momPct: pctChange(momCallSuccRateCurr, momCallSuccRatePrev) },
      bookings:       { wowPct: pctChange(wowBookCurr, wowBookPrev),                 momPct: pctChange(momBookCurr, momBookPrev) },
      conversionRate: { wowPct: pctChange(wowConvRateCurr, wowConvRatePrev),         momPct: pctChange(momConvRateCurr, momConvRatePrev) },
    };

    // ── SPARKLINES — weekly buckets, last 12 weeks ─────────────────────────────
    const MS_WEEK = 7 * 24 * 60 * 60 * 1000;
    function weekLabel(d: Date): string {
      const m = d.toLocaleString("en-US", { month: "short" });
      return `${m} ${d.getDate()}`;
    }

    // Build 12 week bucket boundaries (oldest first)
    const weekBuckets: Array<{ start: string; end: string; label: string }> = [];
    for (let i = 11; i >= 0; i--) {
      const end   = new Date(now.getTime() - i * MS_WEEK);
      const start = new Date(end.getTime() - MS_WEEK);
      weekBuckets.push({
        start: start.toISOString(),
        end:   end.toISOString(),
        label: weekLabel(start),
      });
    }

    const sparklines = {
      leadsCreated: weekBuckets.map(b => ({
        label: b.label,
        value: leads.filter(l => l.created_at >= b.start && l.created_at < b.end).length,
      })),
      // Conversion rate per weekly cohort: of leads created that week, % now sale_done
      conversionRate: weekBuckets.map(b => {
        const cohort = leads.filter(l => l.created_at >= b.start && l.created_at < b.end);
        const sales  = cohort.filter(l => l.status === "sale_done").length;
        return { label: b.label, value: cohort.length > 0 ? Math.round((sales / cohort.length) * 100) : 0 };
      }),
      callSuccessRate: weekBuckets.map(b => {
        const wc  = calls.filter(c => c.started_at >= b.start && c.started_at < b.end);
        const suc = wc.filter(c => c.call_successful === true).length;
        return { label: b.label, value: wc.length > 0 ? Math.round((suc / wc.length) * 100) : 0 };
      }),
      bookingsPerWeek: weekBuckets.map(b => ({
        label: b.label,
        value: bookings.filter(bk => bk.created_at >= b.start && bk.created_at < b.end).length,
      })),
    };

    // ── RETURN — no credentials, no raw settings ──────────────────────────────
    return {
      agents, agentPerf,
      trends,
      sparklines,
      calls: {
        total: totalCalls, success: successCalls, successRate,
        avgDuration, inbound: inboundCalls, outbound: outboundCalls,
        last7: callsLast7, today: callsToday,
      },
      leads: {
        total: totalLeads, active: activeLeads, needCall: needCallLeads,
        staleCount: staleLeads.length, staleDetail: staleLeadDetail,
        neverCalledCount: neverCalled.length, neverCalledDetail,
        sales: saleLeads, newLast7: newLeads7, newLast30: newLeads30,
        conversionRate, followUpCoverage, avgResponseHrs,
        repeatContacts, stalledPipeline,
        hotLeadCount: hotLeads.length, hotLeadDetail,
      },
      bookings: {
        total: totalBookings, last7: bookings7,
        agentBooked: agentBookings, bookingRate,
        noShowCount: noShowBookings.length, noShowDetail,
      },
      campaigns: {
        total: campaigns.length, active: activeCampaigns, stats: campaignStats,
      },
      whatsapp: { total: waTotal, inbound: waInbound, outbound: waOutbound },
      email: { total: hexmailCampaigns.length, active: activeEmail },
      telephony: { total: telephonyCalls.length },
      phoneNumbers,
      marketing: {
        seoKeywords:        totalSeoKeywords,
        seoSitesCount:      seoSites.length,
        recentContentCount,
        competitorsCount,
        followUpCampaignsCount: followUpCampaigns.length,
        waOutboundLast30,
        hasWaContacts,
      },
      systemHealth,
      // Paid ads analytics (from synced growthmind_campaigns rows)
      ads: {
        hasSyncedData:     adsCampaigns.length > 0,
        totalCampaigns:    adsCampaigns.length,
        activeCampaigns:   adsCampaigns.filter(c => c.status === "active").length,
        totalSpend:        totalAdSpend,
        totalRevenue:      +totalAdRevenue.toFixed(2),
        blendedRoas:       blendedRoasAll,
        bestPlatformByCpl,
        worstPlatformByCpl,
        meta:              metaTotals,
        google:            googleTotals,
        topCampaigns:   adsCampaigns.slice(0, 10).map(c => ({
          id:          c.id,
          name:        c.name,
          platform:    c.platform,
          status:      c.status,
          spend:       Number(c.spend ?? 0),
          impressions: Number(c.impressions ?? 0),
          clicks:      Number(c.clicks ?? 0),
          conversions: Number(c.conversions ?? 0),
          roas:        c.roas ? Number(c.roas) : null,
          dateStart:   c.date_start,
          dateEnd:     c.date_end,
          syncedAt:    c.synced_at,
        })),
      },
      // No `settings` key — credentials never leave the server
    };
}

// ── Save recommendations to DB (called from client after generating) ───────────
// Client generates recs from platform data, then calls this to persist them.
export const saveGrowthMindRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      recommendations: z.array(z.object({
        category:     z.string(),
        priority:     z.string(),
        problem:      z.string(),
        impact:       z.string().optional(),
        fix:          z.string(),
        action_href:  z.string().nullable().optional(),
        action_label: z.string().nullable().optional(),
      })),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    try {
      // Replace all existing recs for this workspace
      await sb
        .from("growthmind_recommendations")
        .delete()
        .eq("workspace_id", workspaceId);

      if (data.recommendations.length > 0) {
        const rows = data.recommendations.map(r => ({
          workspace_id:  workspaceId,
          category:      r.category,
          priority:      r.priority,
          problem:       r.problem,
          impact:        r.impact ?? "",
          fix:           r.fix,
          action_href:   r.action_href ?? null,
          action_label:  r.action_label ?? null,
          is_dismissed:  false,
          refreshed_at:  new Date().toISOString(),
        }));
        await sb.from("growthmind_recommendations").insert(rows);
      }
      return { ok: true };
    } catch {
      // DB may not be migrated yet — fail silently
      return { ok: false };
    }
  });

// ── Load recommendations from DB ───────────────────────────────────────────────
export const getStoredGrowthMindRecommendations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    try {
      const { data } = await sb
        .from("growthmind_recommendations")
        .select("id, category, priority, problem, impact, fix, action_href, action_label, refreshed_at")
        .eq("workspace_id", workspaceId)
        .eq("is_dismissed", false)
        .order("created_at", { ascending: false })
        .limit(50);

      const rows: any[] = data ?? [];
      const refreshedAt = rows[0]?.refreshed_at ?? null;
      const staleThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const isStale = rows.length === 0 || refreshedAt < staleThreshold;

      const recommendations: GrowthRecommendation[] = rows.map(r => ({
        id:       r.id,
        category: r.category,
        priority: r.priority,
        problem:  r.problem,
        impact:   r.impact,
        fix:      r.fix,
        action:   r.action_href ? { href: r.action_href, label: r.action_label ?? "View" } : undefined,
      }));

      return { recommendations, stale: isStale, refreshedAt };
    } catch {
      return { recommendations: [], stale: true, refreshedAt: null };
    }
  });
