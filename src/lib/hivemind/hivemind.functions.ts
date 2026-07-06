import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cacheWrap, cacheDel } from "@/lib/cache/redis.server";
import {
  getWbahDerivedLeads,
  isWbahPositiveOrNeutral,
} from "@/lib/integrations/webespokeEnterprise/wbah-leads.server";

const HIVEMIND_PLATFORM_TTL = 5 * 60; // 5 minutes

function hivemindPlatformKey(workspaceId: string) {
  return `webee:hivemind:${workspaceId}:platform`;
}

export type HiveMindTask = {
  id: string;
  title: string;
  category: string;
  status: "suggested" | "approved" | "completed";
  createdAt: string;
  completedAt?: string;
};

// ── WBAH lead/booking derivation ───────────────────────────────────────────────
// WBAH's `leads` table is dup-inflated (~400k rows) — any ORDER BY / COUNT over it
// exceeds the authenticated role's 8s statement_timeout and silently returns [] →
// "0 leads / 0 bookings" on the HiveMind pages. The dashboard, Pipeline board and
// HiveMind chat all avoid this by deriving WBAH "leads" from the small, clean
// `wbah_calls` table. The actual paging/dedup/booking logic now lives in the shared
// getWbahDerivedLeads helper (wbah-leads.server.ts) so this surface can never drift
// from the Pipeline board or HiveMind chat. Here we just apply the positive/neutral
// filter and shape rows like `leads` so the downstream breakdown logic works unchanged.
const WBAH_WORKSPACE_ID = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";

async function deriveWbahLeadsFromCalls(workspaceId: string): Promise<any[]> {
  // Paging/dedup/booking logic lives in the shared getWbahDerivedLeads helper so the
  // WBAH "lead"/"booking" definition can never drift between the Pipeline board,
  // HiveMind chat and HiveMind pages. Swallow errors and return [] so a transient
  // wbah_calls read failure degrades to "0 leads" (logged) rather than crashing the
  // whole HiveMind pages data fetch.
  try {
    const rows = await getWbahDerivedLeads(workspaceId);
    const leads = rows.filter(isWbahPositiveOrNeutral).map((c) => ({
      id: c.id,
      full_name: c.customer_name ?? "Unknown",
      name: c.customer_name ?? "Unknown",
      status: null,
      pipeline_stage: null,
      created_at: c.started_at,
      updated_at: c.started_at,
      agent_id: null,
      source: null,
      interest_level: null,
      sentiment: c.sentiment,
      // "booked" mirrors the Sales Pipeline board: positive contact with an
      // appointment_date or a Calendly link (WBAH's calendar_bookings is empty).
      booked: c.booked,
    }));
    console.log(`[HiveMind pages] WBAH leads derived from wbah_calls: ${leads.length} positive/neutral contacts`);
    return leads;
  } catch (e: any) {
    console.error("[HiveMind pages] wbah_calls derivation error:", e?.message ?? e);
    return [];
  }
}

// ── Main platform data aggregator ──────────────────────────────────────────────
export const getHiveMindPlatformData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const url = context.request?.url ?? "";
    const bust = process.env.NODE_ENV !== "production" && new URL(url, "http://x").searchParams.has("bust");

    return cacheWrap(
      hivemindPlatformKey(workspaceId),
      HIVEMIND_PLATFORM_TTL,
      async () => {
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const since7  = new Date(now); since7.setDate(now.getDate() - 7);
    const since14 = new Date(now); since14.setDate(now.getDate() - 14);
    const since30 = new Date(now); since30.setDate(now.getDate() - 30);

    const todayStr  = todayStart.toISOString();
    const s7str     = since7.toISOString();
    const s14str    = since14.toISOString();
    const s30str    = since30.toISOString();

    // WBAH's leads table is unusable (~400k dup rows → statement timeout → "0 leads");
    // detect it up front so we skip the doomed leads/calendar_bookings queries and
    // derive both from the small, clean wbah_calls table instead (see comment above
    // deriveWbahLeadsFromCalls). ID fallback guards against an RLS-blocked slug lookup.
    const { data: wsRow, error: wsErr } = await sb
      .from("workspaces").select("slug").eq("id", workspaceId).maybeSingle();
    if (wsErr) console.error("[HiveMind pages] workspace slug lookup error:", wsErr.message);
    const isWbah = wsRow?.slug === "webuyanyhouse" || workspaceId === WBAH_WORKSPACE_ID;
    // Kick off the WBAH derivation now so it runs concurrently with the main batch.
    const wbahLeadsPromise: Promise<any[] | null> = isWbah
      ? deriveWbahLeadsFromCalls(workspaceId)
      : Promise.resolve(null);

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

      // For WBAH skip the leads table entirely (see isWbah note) — derived below.
      isWbah
        ? Promise.resolve({ data: [] as any[], error: null })
        : sb.from("leads")
            .select("id, status, pipeline_stage, updated_at, created_at, full_name, name")
            .eq("workspace_id", workspaceId)
            .limit(5000),

      // WBAH's calendar_bookings table is empty (bookings live in wbah_calls) — skip
      // and derive below. Standard workspaces keep using calendar_bookings.
      // Fix #2: column is `title`, not `event_name`
      isWbah
        ? Promise.resolve({ data: [] as any[], error: null })
        : sb.from("calendar_bookings")
            .select("id, agent_id, status, created_at, title")
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
    const wbahLeadRows           = await wbahLeadsPromise;
    // For WBAH, the wbah_calls-derived array IS the full lead set (see isWbah note);
    // it replaces the (deliberately empty) leads-table result so all downstream
    // counts match the Pipeline board and HiveMind chat.
    const leads: any[]           = (isWbah && wbahLeadRows) ? wbahLeadRows : (leadsRes.data ?? []);
    // WBAH bookings = positive contacts with an appointment/Calendly link (mirrors the
    // Sales Pipeline "Bookings" stage); standard workspaces use calendar_bookings.
    const bookings: any[]        = (isWbah && wbahLeadRows)
      ? wbahLeadRows.filter(l => l.sentiment === "positive" && l.booked)
      : (bookingsRes.data ?? []);
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
  }, bust);
  });

// ── Briefing data ──────────────────────────────────────────────────────────────
export const getHiveMindBriefing = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      since:     z.string().optional(),
      staleDays: z.coerce.number().optional(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const sinceStr  = data.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const staleDays = data.staleDays ?? 7;
    const staleDate = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString();

    const ACTIVE_STATUSES = ["need_to_call", "contacted", "in_progress", "follow_up", "new", "qualified", "interested"];
    const TERMINAL_STATUSES = "sale_done,do_not_call,not_interested"; // no quotes — PostgREST text format

    const [newLeadsRes, newBookingsRes, staleRes, pipelineChangesRes, waRes, agentsRes, emailRes] = await Promise.all([
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

      // Fix #1: PostgREST .not().in() — no quotes around text values
      sb.from("leads")
        .select("id, full_name, name, status, pipeline_stage, updated_at, phone, email")
        .eq("workspace_id", workspaceId)
        .gte("updated_at", sinceStr)
        .not("status", "in", `(${TERMINAL_STATUSES})`)
        .order("updated_at", { ascending: false })
        .limit(20),

      // Fix #12: fetch actual message bodies for previews
      sb.from("whatsapp_messages")
        .select("id, body, contact_name, contact_phone, direction, sent_at, created_at")
        .eq("workspace_id", workspaceId)
        .eq("direction", "inbound")
        .gte("created_at", sinceStr)
        .order("created_at", { ascending: false })
        .limit(10),

      sb.from("agents")
        .select("id, name")
        .eq("workspace_id", workspaceId),

      // Fix #11: email campaign activity
      sb.from("hexmail_campaigns")
        .select("id, name, status, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .gte("updated_at", sinceStr)
        .order("updated_at", { ascending: false })
        .limit(10),
    ]);

    const agentMap = new Map<string, string>(
      (agentsRes.data ?? []).map((a: any) => [a.id, a.name])
    );

    // Fix #8: removed minsAgo — unused dead code, client uses fmtRelative(created_at)
    const newLeads = (newLeadsRes.data ?? []).map((l: any) => ({
      id: l.id,
      name: l.full_name ?? l.name ?? "Unknown",
      status: l.status,
      pipeline_stage: l.pipeline_stage,
      phone: l.phone,
      email: l.email,
      created_at: l.created_at,
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

    // Fix #7: exclude leads that already appear in newLeads (no duplicates)
    const newLeadIdSet = new Set(newLeads.map((l: any) => l.id));
    const recentPipelineChanges = (pipelineChangesRes.data ?? [])
      .filter((l: any) => !newLeadIdSet.has(l.id))
      .map((l: any) => ({
        id: l.id,
        name: l.full_name ?? l.name ?? "Unknown",
        status: l.status,
        pipeline_stage: l.pipeline_stage,
        updated_at: l.updated_at,
      }));

    // Fix #12: WhatsApp with real message previews
    const inboundWA = (waRes.data ?? []).map((m: any) => ({
      id: m.id,
      body: (m.body ?? "").slice(0, 120),
      contact_name: m.contact_name,
      contact_phone: m.contact_phone,
      sent_at: m.sent_at ?? m.created_at,
    }));

    // Fix #11: email campaign activity
    const recentEmailCampaigns = (emailRes.data ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      updated_at: c.updated_at,
      created_at: c.created_at,
      isNew: c.created_at >= sinceStr,
    }));

    return {
      newLeads,
      newBookings,
      staleClients,
      recentPipelineChanges,
      inboundWA,
      recentEmailCampaigns,
      sinceStr,
      staleDays,
      // For backwards compat used in businessCount calc
      newInboundWA: inboundWA.length,
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
