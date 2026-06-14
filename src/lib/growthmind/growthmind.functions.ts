import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Main marketing data aggregator ─────────────────────────────────────────────
export const getGrowthMindData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const now      = new Date();
    const since7   = new Date(now); since7.setDate(now.getDate() - 7);
    const since14  = new Date(now); since14.setDate(now.getDate() - 14);
    const since30  = new Date(now); since30.setDate(now.getDate() - 30);
    const since90  = new Date(now); since90.setDate(now.getDate() - 90);
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);

    const s7    = since7.toISOString();
    const s14   = since14.toISOString();
    const s30   = since30.toISOString();
    const s90   = since90.toISOString();
    const today = todayStart.toISOString();

    const [
      agentsRes, callsRes, leadsRes, bookingsRes, settingsRes,
      campaignsRes, waMessagesRes, hexmailRes, telephonyRes, phoneNumsRes,
    ] = await Promise.all([
      sb.from("agents")
        .select("id, name, retell_agent_id, inbound_phone_number, settings, created_at, updated_at")
        .eq("workspace_id", workspaceId),

      sb.from("calls")
        .select("id, agent_id, agent_name, call_status, call_successful, duration_seconds, sentiment, started_at, call_type, from_number, to_number")
        .eq("workspace_id", workspaceId)
        .gte("started_at", s30)
        .order("started_at", { ascending: false })
        .limit(2000),

      sb.from("leads")
        .select("id, status, pipeline_stage, updated_at, created_at, full_name, name, phone, email, source")
        .eq("workspace_id", workspaceId)
        .limit(5000),

      sb.from("calendar_bookings")
        .select("id, agent_id, status, created_at, title, attendee_name, attendee_email, start_at")
        .eq("workspace_id", workspaceId)
        .limit(1000),

      sb.from("workspace_settings")
        .select("calcom_api_key, retell_default_agent_id, retell_workspace_id, elevenlabs_api_key, openai_api_key, whatsapp_phone_id, twilio_auth_token, twilio_account_sid")
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
        .select("id, name, status, created_at, updated_at")
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
    ]);

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

    // ── CALLS ────────────────────────────────────────────────────────────────
    const totalCalls      = calls.length;
    const successCalls    = calls.filter(c => c.call_successful === true).length;
    const successRate     = totalCalls > 0 ? Math.round((successCalls / totalCalls) * 100) : 0;
    const durCalls        = calls.filter(c => c.duration_seconds > 0);
    const avgDuration     = durCalls.length > 0
      ? Math.round(durCalls.reduce((s, c) => s + c.duration_seconds, 0) / durCalls.length) : 0;
    const inboundCalls    = calls.filter(c => c.call_type === "inbound").length;
    const outboundCalls   = calls.filter(c => c.call_type !== "inbound").length;
    const callsLast7      = calls.filter(c => c.started_at >= s7).length;
    const callsToday      = calls.filter(c => c.started_at >= today).length;

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
    // Leads that have had at least one call vs total active leads
    const calledLeadIds = new Set(calls.map(c => c.from_number).concat(calls.map(c => c.to_number)));
    const activeLeadList = leads.filter(l =>
      l.status !== "sale_done" && l.status !== "do_not_call" && l.status !== "not_interested"
    );
    const followUpCoverage = activeLeadList.length > 0
      ? Math.round((activeLeadList.filter(l => l.phone && calledLeadIds.has(l.phone)).length / activeLeadList.length) * 100)
      : 100;

    // ── LEAD RESPONSE TIME ────────────────────────────────────────────────────
    // Avg hours from lead created to first call (rough proxy)
    const firstCallByLead = new Map<string, number>();
    for (const c of calls) {
      const phone = c.to_number ?? c.from_number;
      if (!phone) continue;
      const t = new Date(c.started_at).getTime();
      if (!firstCallByLead.has(phone) || firstCallByLead.get(phone)! > t) {
        firstCallByLead.set(phone, t);
      }
    }
    const responseTimes: number[] = [];
    for (const l of leads.filter(l => l.phone && l.created_at >= s30)) {
      const firstCall = firstCallByLead.get(l.phone);
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

    // ── SYSTEM HEALTH ─────────────────────────────────────────────────────────
    const systemHealth = {
      retell:      !!(settings.retell_workspace_id || settings.retell_default_agent_id),
      calcom:      !!settings.calcom_api_key,
      elevenlabs:  !!settings.elevenlabs_api_key,
      openai:      !!settings.openai_api_key,
      whatsapp:    !!settings.whatsapp_phone_id,
      twilio:      !!(settings.twilio_auth_token && settings.twilio_account_sid),
      agents:      agents.length > 0,
      campaigns:   campaigns.length > 0,
      email:       hexmailCampaigns.length > 0,
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

    return {
      agents, agentPerf,
      calls: {
        total: totalCalls, success: successCalls, successRate,
        avgDuration, inbound: inboundCalls, outbound: outboundCalls,
        last7: callsLast7, today: callsToday,
      },
      leads: {
        total: totalLeads, active: activeLeads, needCall: needCallLeads,
        staleCount: staleLeads.length, staleDetail: staleLeadDetail,
        sales: saleLeads, newLast7: newLeads7, newLast30: newLeads30,
        conversionRate, followUpCoverage, avgResponseHrs,
      },
      bookings: {
        total: totalBookings, last7: bookings7,
        agentBooked: agentBookings, bookingRate,
      },
      campaigns: {
        total: campaigns.length, active: activeCampaigns, stats: campaignStats,
      },
      whatsapp: { total: waTotal, inbound: waInbound, outbound: waOutbound },
      email: { total: hexmailCampaigns.length, active: activeEmail },
      telephony: { total: telephonyCalls.length },
      phoneNumbers,
      systemHealth,
      settings,
    };
  });
