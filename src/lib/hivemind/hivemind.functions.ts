import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type HiveMindTask = {
  id: string;
  title: string;
  category: string;
  status: "suggested" | "approved" | "completed";
  createdAt: string;
  completedAt?: string;
};

// ── Main platform data aggregator ──────────────────────────────────────────────
export const getHiveMindPlatformData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const since7  = new Date(now); since7.setDate(now.getDate() - 7);
    const since14 = new Date(now); since14.setDate(now.getDate() - 14);
    const since30 = new Date(now); since30.setDate(now.getDate() - 30);

    const todayStr  = todayStart.toISOString();
    const s7str     = since7.toISOString();
    const s14str    = since14.toISOString();
    const s30str    = since30.toISOString();

    const [
      agentsRes, callsRes, leadsRes, bookingsRes, settingsRes,
      campaignsRes, waMessagesRes, watiContactsRes,
      telephonyRes, hexmailRes, phoneNumsRes, callEventsRes,
    ] = await Promise.all([
      sb.from("agents")
        .select("id, name, retell_agent_id, inbound_phone_number, settings, created_at, updated_at")
        .eq("workspace_id", workspaceId),

      sb.from("calls")
        .select("id, agent_id, agent_name, call_status, call_successful, duration_seconds, sentiment, started_at, call_type")
        .eq("workspace_id", workspaceId)
        .gte("started_at", s30str)
        .order("started_at", { ascending: false })
        .limit(1000),

      sb.from("leads")
        .select("id, status, pipeline_stage, updated_at, created_at, full_name, name")
        .eq("workspace_id", workspaceId)
        .limit(5000),

      sb.from("calendar_bookings")
        .select("id, agent_id, status, created_at, event_name")
        .eq("workspace_id", workspaceId)
        .limit(500),

      sb.from("workspace_settings")
        .select("calcom_api_key, retell_default_agent_id, retell_workspace_id, elevenlabs_api_key, openai_api_key, hivemind_retell_agent_id, hivemind_tasks, whatsapp_phone_id, twilio_auth_token, twilio_account_sid")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),

      sb.from("call_campaigns")
        .select("id, name, status, total_leads, completed_calls, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .limit(100),

      sb.from("whatsapp_messages")
        .select("id, direction, created_at, status")
        .eq("workspace_id", workspaceId)
        .gte("created_at", s30str)
        .limit(1000),

      sb.from("wati_contacts")
        .select("id, created_at, opted_in")
        .eq("workspace_id", workspaceId)
        .limit(500),

      sb.from("telephony_calls")
        .select("id, direction, status, duration, created_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", s30str)
        .limit(500),

      sb.from("hexmail_campaigns")
        .select("id, name, status, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .limit(50),

      sb.from("phone_numbers")
        .select("id, phone_number, agent_id, active, created_at")
        .eq("workspace_id", workspaceId)
        .limit(50),

      sb.from("calls")
        .select("id, started_at, call_successful")
        .eq("workspace_id", workspaceId)
        .gte("started_at", todayStr)
        .limit(200),
    ]);

    const agents: any[]          = agentsRes.data          ?? [];
    const calls: any[]           = callsRes.data           ?? [];
    const leads: any[]           = leadsRes.data           ?? [];
    const bookings: any[]        = bookingsRes.data        ?? [];
    const settings: any          = settingsRes.data        ?? {};
    const campaigns: any[]       = campaignsRes.data       ?? [];
    const waMessages: any[]      = waMessagesRes.data      ?? [];
    const watiContacts: any[]    = watiContactsRes.data    ?? [];
    const telephonyCalls: any[]  = telephonyRes.data       ?? [];
    const hexmailCampaigns: any[]= hexmailRes.data         ?? [];
    const phoneNumbers: any[]    = phoneNumsRes.data       ?? [];
    const callsToday: any[]      = callEventsRes.data      ?? [];

    // ── TODAY stats ──────────────────────────────────────────────────────────
    const leadsToday    = leads.filter(l => l.created_at >= todayStr).length;
    const bookingsToday = bookings.filter(b => b.created_at >= todayStr).length;
    const waToday       = waMessages.filter(m => m.created_at >= todayStr).length;
    const callsTodayCount = callsToday.length;

    // ── CALLS ────────────────────────────────────────────────────────────────
    const totalCalls       = calls.length;
    const successCalls     = calls.filter(c => c.call_successful === true).length;
    const successRate      = totalCalls > 0 ? Math.round((successCalls / totalCalls) * 100) : 0;
    const durCalls         = calls.filter(c => c.duration_seconds > 0);
    const avgDuration      = durCalls.length > 0
      ? Math.round(durCalls.reduce((s, c) => s + c.duration_seconds, 0) / durCalls.length)
      : 0;
    const inboundCalls     = calls.filter(c => c.call_type === "inbound").length;
    const outboundCalls    = calls.filter(c => c.call_type === "outbound" || !c.call_type).length;

    // ── LEADS ────────────────────────────────────────────────────────────────
    const staleLeads     = leads.filter(l =>
      l.status !== "sale_done" && l.status !== "do_not_call" && l.status !== "not_interested"
      && l.updated_at < s14str
    ).length;
    const needCallLeads  = leads.filter(l => l.status === "need_to_call").length;
    const doNotCall      = leads.filter(l => l.status === "do_not_call" || l.status === "not_interested").length;
    const saleLeads      = leads.filter(l => l.status === "sale_done").length;
    const activeLeads    = leads.filter(l =>
      l.status !== "sale_done" && l.status !== "do_not_call" && l.status !== "not_interested"
    ).length;

    // ── BOOKINGS ─────────────────────────────────────────────────────────────
    const bookingsRecent  = bookings.filter(b => b.created_at >= s7str).length;
    const agentBookings   = bookings.filter(b => b.agent_id).length;

    // ── CAMPAIGNS ────────────────────────────────────────────────────────────
    const activeCampaigns   = campaigns.filter(c => c.status === "running" || c.status === "active").length;
    const stoppedCampaigns  = campaigns.filter(c => c.status === "stopped" || c.status === "paused").length;
    const campaignStats = campaigns.map(c => ({
      id: c.id,
      name: c.name,
      status: c.status as string,
      totalLeads: c.total_leads ?? 0,
      completedCalls: c.completed_calls ?? 0,
      completionPct: c.total_leads > 0
        ? Math.round((c.completed_calls / c.total_leads) * 100)
        : 0,
      createdAt: c.created_at,
    }));

    // ── WHATSAPP ─────────────────────────────────────────────────────────────
    const waInbound   = waMessages.filter(m => m.direction === "inbound").length;
    const waOutbound  = waMessages.filter(m => m.direction === "outbound").length;

    // ── TELEPHONY ────────────────────────────────────────────────────────────
    const tCalls   = telephonyCalls.length;
    const tInbound = telephonyCalls.filter(c => c.direction === "inbound").length;

    // ── EMAIL ────────────────────────────────────────────────────────────────
    const activeEmail  = hexmailCampaigns.filter(c => c.status === "active" || c.status === "running").length;

    // ── AGENT SCORES ─────────────────────────────────────────────────────────
    const callsPerAgent = new Map<string, typeof calls>();
    for (const c of calls) {
      if (!c.agent_id) continue;
      if (!callsPerAgent.has(c.agent_id)) callsPerAgent.set(c.agent_id, []);
      callsPerAgent.get(c.agent_id)!.push(c);
    }
    const phoneByAgent = new Map<string, any>();
    for (const p of phoneNumbers) {
      if (p.agent_id) phoneByAgent.set(p.agent_id, p);
    }

    const agentScores = agents.map(a => {
      const s = (a.settings ?? {}) as Record<string, unknown>;
      const agentCalls  = callsPerAgent.get(a.id) ?? [];
      const successCnt  = agentCalls.filter(c => c.call_successful === true).length;
      const sRate       = agentCalls.length > 0 ? successCnt / agentCalls.length : 0;
      const hasPhone    = !!(s.phoneNumber || a.inbound_phone_number || phoneByAgent.has(a.id));
      const hasKB       = !!(s.knowledgeBaseId || (s.knowledgeBases as any[])?.length);
      const deployed    = !!(s.deployedRetellAgentId || a.retell_agent_id);
      const hasPrompt   = ((s.prompt as string | undefined)?.length ?? 0) > 100;

      let score = 0;
      const breakdown: string[] = [];
      if (deployed)           { score += 25; breakdown.push("Deployed +25"); }
      if (hasPhone)           { score += 15; breakdown.push("Phone assigned +15"); }
      if (agentCalls.length)  { score += 15; breakdown.push("Has call activity +15"); }
      if (sRate >= 0.5)       { score += 20; breakdown.push("Good success rate +20"); }
      if (hasPrompt)          { score += 10; breakdown.push("Has prompt +10"); }
      if (hasKB)              { score += 10; breakdown.push("Has knowledge base +10"); }
      if (settings.calcom_api_key) { score += 5; breakdown.push("Calendar connected +5"); }

      return {
        id: a.id, name: a.name, score,
        breakdown, callCount: agentCalls.length,
        successRate: Math.round(sRate * 100),
        deployed, hasPhone, hasKB,
        deploymentMode: (s.deploymentMode as string) ?? "retell",
        lastCallAt: agentCalls[0]?.started_at ?? null,
        phone: a.inbound_phone_number ?? (phoneByAgent.get(a.id)?.phone_number ?? null),
      };
    }).sort((a, b) => b.score - a.score);

    // ── SYSTEM HEALTH ─────────────────────────────────────────────────────────
    const systemHealth = {
      retell:       !!(settings.retell_workspace_id || settings.retell_default_agent_id),
      calcom:       !!settings.calcom_api_key,
      twilio:       !!(settings.twilio_auth_token && settings.twilio_account_sid),
      whatsapp:     !!settings.whatsapp_phone_id,
      elevenlabs:   !!settings.elevenlabs_api_key,
      openai:       !!settings.openai_api_key,
      agents:       agents.length > 0,
      campaigns:    campaigns.length > 0,
      phoneNumbers: phoneNumbers.length > 0,
      emailCampaigns: hexmailCampaigns.length > 0,
      wati:         watiContacts.length > 0,
    };

    // ── COST ESTIMATES ────────────────────────────────────────────────────────
    const retellCostEst = totalCalls > 0 ? +(((totalCalls * avgDuration) / 60) * 0.05).toFixed(2) : 0;

    // ── TASKS ─────────────────────────────────────────────────────────────────
    const tasks: HiveMindTask[] = (() => {
      try { return (settings.hivemind_tasks as HiveMindTask[] | null) ?? []; } catch { return []; }
    })();

    return {
      agents,
      agentScores,
      today: {
        calls:    callsTodayCount,
        leads:    leadsToday,
        bookings: bookingsToday,
        messages: waToday,
      },
      calls: {
        total: totalCalls, success: successCalls, successRate,
        avgDuration, inbound: inboundCalls, outbound: outboundCalls,
      },
      leads: {
        total: leads.length, active: activeLeads, needCall: needCallLeads,
        stale: staleLeads, doNotCall, sales: saleLeads,
      },
      bookings: { total: bookings.length, recent: bookingsRecent, agentBooked: agentBookings },
      campaigns: {
        total: campaigns.length, active: activeCampaigns,
        stopped: stoppedCampaigns, stats: campaignStats,
      },
      whatsapp: { total: waMessages.length, inbound: waInbound, outbound: waOutbound, contacts: watiContacts.length },
      telephony: { total: tCalls, inbound: tInbound },
      email:     { total: hexmailCampaigns.length, active: activeEmail },
      phoneNumbers,
      costs:     { retellEst: retellCostEst },
      systemHealth,
      settings,
      tasks,
    };
  });

// ── Briefing data ──────────────────────────────────────────────────────────────
export const getHiveMindBriefing = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { since?: string; staleDays?: number }) => input)
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const sinceStr = data.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const staleDays = data.staleDays ?? 7;
    const staleDate = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString();

    const ACTIVE_STATUSES = ["need_to_call", "contacted", "in_progress", "follow_up", "new", "qualified", "interested"];

    const [newLeadsRes, newBookingsRes, staleRes, pipelineChangesRes, waRes, agentsRes] = await Promise.all([
      sb.from("leads")
        .select("id, full_name, name, status, pipeline_stage, phone, email, created_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", sinceStr)
        .order("created_at", { ascending: false })
        .limit(50),

      sb.from("calendar_bookings")
        .select("id, title, attendee_name, attendee_email, start_at, end_at, agent_id, status, created_at, notes")
        .eq("workspace_id", workspaceId)
        .gte("created_at", sinceStr)
        .order("start_at", { ascending: true })
        .limit(20),

      sb.from("leads")
        .select("id, full_name, name, status, pipeline_stage, updated_at, phone, email")
        .eq("workspace_id", workspaceId)
        .in("status", ACTIVE_STATUSES)
        .lt("updated_at", staleDate)
        .order("updated_at", { ascending: true })
        .limit(30),

      sb.from("leads")
        .select("id, full_name, name, status, pipeline_stage, updated_at, phone, email")
        .eq("workspace_id", workspaceId)
        .gte("updated_at", sinceStr)
        .not("status", "in", `("sale_done","do_not_call","not_interested")`)
        .order("updated_at", { ascending: false })
        .limit(20),

      sb.from("whatsapp_messages")
        .select("id, direction, created_at, status")
        .eq("workspace_id", workspaceId)
        .eq("direction", "inbound")
        .gte("created_at", sinceStr)
        .limit(100),

      sb.from("agents")
        .select("id, name")
        .eq("workspace_id", workspaceId),
    ]);

    const agentMap = new Map<string, string>(
      (agentsRes.data ?? []).map((a: any) => [a.id, a.name])
    );

    const newLeads = (newLeadsRes.data ?? []).map((l: any) => ({
      id: l.id,
      name: l.full_name ?? l.name ?? "Unknown",
      status: l.status,
      pipeline_stage: l.pipeline_stage,
      phone: l.phone,
      email: l.email,
      created_at: l.created_at,
      minsAgo: Math.round((Date.now() - new Date(l.created_at).getTime()) / 60000),
    }));

    const newBookings = (newBookingsRes.data ?? []).map((b: any) => ({
      id: b.id,
      title: b.title ?? "Appointment",
      attendee_name: b.attendee_name,
      attendee_email: b.attendee_email,
      start_at: b.start_at,
      end_at: b.end_at,
      status: b.status,
      notes: b.notes,
      agent_name: b.agent_id ? (agentMap.get(b.agent_id) ?? null) : null,
      created_at: b.created_at,
    }));

    const staleClients = (staleRes.data ?? []).map((l: any) => {
      const days = Math.floor((Date.now() - new Date(l.updated_at).getTime()) / 86400000);
      return {
        id: l.id,
        name: l.full_name ?? l.name ?? "Unknown",
        status: l.status,
        pipeline_stage: l.pipeline_stage,
        days,
        updated_at: l.updated_at,
        phone: l.phone,
        email: l.email,
      };
    });

    const recentPipelineChanges = (pipelineChangesRes.data ?? []).map((l: any) => ({
      id: l.id,
      name: l.full_name ?? l.name ?? "Unknown",
      status: l.status,
      pipeline_stage: l.pipeline_stage,
      updated_at: l.updated_at,
      hoursAgo: Math.round((Date.now() - new Date(l.updated_at).getTime()) / 3600000),
    }));

    const newInboundWA = (waRes.data ?? []).length;

    return {
      newLeads,
      newBookings,
      staleClients,
      recentPipelineChanges,
      newInboundWA,
      sinceStr,
      staleDays,
    };
  });

// ── Save tasks ─────────────────────────────────────────────────────────────────
export const saveHiveMindTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tasks: HiveMindTask[] }) => input)
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    try {
      const { error } = await sb
        .from("workspace_settings")
        .upsert({ workspace_id: workspaceId, hivemind_tasks: data.tasks }, { onConflict: "workspace_id" });
      if (error) {
        if (String(error.code) === "42703" || String(error.message).includes("hivemind_tasks"))
          return { ok: true, columnMissing: true };
        throw new Error(error.message);
      }
      return { ok: true, columnMissing: false };
    } catch (e: any) {
      if (String(e.message).includes("hivemind_tasks") || String(e.code) === "42703")
        return { ok: true, columnMissing: true };
      throw e;
    }
  });

// ── HiveMind agent ID ──────────────────────────────────────────────────────────
export const getHiveMindAgentId = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) return { agentId: null, columnMissing: false };
    try {
      const { data, error } = await supabaseAdmin
        .from("workspace_settings" as never)
        .select("hivemind_retell_agent_id")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (error) {
        if (String((error as any).code) === "42703") return { agentId: null, columnMissing: true };
        return { agentId: null, columnMissing: false };
      }
      return { agentId: (data as any)?.hivemind_retell_agent_id ?? null, columnMissing: false };
    } catch { return { agentId: null, columnMissing: false }; }
  });

export const saveHiveMindAgentId = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ agentId: z.string().nullable() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    try {
      const { error } = await sb
        .from("workspace_settings")
        .upsert({ workspace_id: workspaceId, hivemind_retell_agent_id: data.agentId || null }, { onConflict: "workspace_id" });
      if (error) {
        if (String(error.code) === "42703") return { ok: true, columnMissing: true };
        throw new Error(error.message);
      }
      return { ok: true, columnMissing: false };
    } catch (e: any) {
      if (String(e.message).includes("hivemind_retell_agent_id")) return { ok: true, columnMissing: true };
      throw e;
    }
  });
