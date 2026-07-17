/**
 * Analytics Hub — plain async aggregation helpers (server only).
 *
 * INVARIANTS (spec §23 / §24 — do not weaken):
 *   • READ-ONLY. Nothing here mutates campaigns, leads, calls or workflows.
 *   • Workspace-scoped: every query MUST `.eq("workspace_id", workspaceId)`.
 *   • WBAH isolation: WBAH uses the `wbah_calls` table; campaign/report sections
 *     are hidden for WBAH. The giant `leads` table (~400k rows for WBAH) is only
 *     ever counted (head:true), never ORDER BY'd / row-fetched.
 *   • Fail closed: any error → a zeroed structure carrying an `error` field.
 *     Never leak another workspace's data, never throw to callers.
 *   • Bounded: row-level aggregation queries cap at 1000 rows; large-table
 *     tallies prefer count:exact head:true.
 *
 * These helpers take the admin client so they are reusable by executive context
 * builders (HiveMind / GrowthMind / AccountsMind / SystemMind). Callers in
 * analytics-hub.functions.ts handle auth + membership + feature gates.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isWbahWorkspaceId } from "@/lib/wbah-exclusion.shared";

type Sb = any;

const ROW_CAP = 1000;

// ── Date range resolution ─────────────────────────────────────────────────────
export type AnalyticsDateFilter =
  | "today" | "yesterday" | "7d" | "30d" | "this_month" | "last_month" | "custom";

export interface AnalyticsFilters {
  dateFilter?: AnalyticsDateFilter;
  customStart?: string | null;
  customEnd?: string | null;
  campaignId?: string | null;
  agentId?: string | null;
  source?: string | null;
}

export interface ResolvedRange {
  startIso: string;
  endIso: string;
  filter: AnalyticsDateFilter;
  days: number;
}

/** Resolve a date filter into an inclusive [startIso, endIso] UTC window. */
export function resolveDateRange(filters?: AnalyticsFilters): ResolvedRange {
  const filter = filters?.dateFilter ?? "30d";
  const now = new Date();
  const endOfToday = new Date(now); endOfToday.setUTCHours(23, 59, 59, 999);
  const startOfToday = new Date(now); startOfToday.setUTCHours(0, 0, 0, 0);

  const mk = (start: Date, end: Date): ResolvedRange => {
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
    return { startIso: start.toISOString(), endIso: end.toISOString(), filter, days };
  };

  switch (filter) {
    case "today":
      return mk(startOfToday, endOfToday);
    case "yesterday": {
      const y = new Date(now.getTime() - 86_400_000);
      const s = new Date(y); s.setUTCHours(0, 0, 0, 0);
      const e = new Date(y); e.setUTCHours(23, 59, 59, 999);
      return mk(s, e);
    }
    case "7d":
      return mk(new Date(now.getTime() - 7 * 86_400_000), endOfToday);
    case "this_month": {
      const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
      return mk(s, endOfToday);
    }
    case "last_month": {
      const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0));
      const e = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
      return mk(s, e);
    }
    case "custom": {
      const s = filters?.customStart ? new Date(filters.customStart) : new Date(now.getTime() - 30 * 86_400_000);
      const e = filters?.customEnd ? new Date(filters.customEnd) : endOfToday;
      if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) {
        return mk(new Date(now.getTime() - 30 * 86_400_000), endOfToday);
      }
      return mk(s, e);
    }
    case "30d":
    default:
      return mk(new Date(now.getTime() - 30 * 86_400_000), endOfToday);
  }
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function rate(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}
function safeDiv(a: number, b: number): number {
  return b > 0 ? Math.round((a / b) * 100) / 100 : 0;
}
function centsToPounds(cents: number): number {
  return Math.round(cents) / 100;
}
function dayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const VOICEMAIL_STATUSES = new Set(["voicemail"]);

// Static enum lists — mirror the DB enums (lead_status / lead_source). We use a
// static list rather than scanning the giant leads table for distinct values.
export const LEAD_STATUS_VALUES = [
  "need_to_call", "calling", "completed", "interested",
  "not_interested", "not_connected", "do_not_call", "qualified",
] as const;
export const LEAD_SOURCE_VALUES = [
  "website", "inbound", "outbound", "referral", "import",
  "website_form", "facebook_lead_form", "google_ads_lead_form", "webee_website_form",
] as const;

function classifyStandardCall(c: any): "voicemail" | "connected" | "missed" | "failed" | "other" {
  if (c.is_voicemail === true || c.in_voicemail === true || VOICEMAIL_STATUSES.has(c.call_status)) return "voicemail";
  if (c.call_status === "completed") return "connected";
  if (c.call_status === "no_answer" || c.call_status === "busy") return "missed";
  if (c.call_status === "failed") return "failed";
  return "other";
}

// ── Standard-workspace call fetch (paged — PostgREST caps single responses at
// 1000 rows, so busy workspaces need chunked .range() fetches) ────────────────
const CALL_FETCH_PAGE = 1000;
const CALL_FETCH_MAX_PAGES = 25;

async function fetchStandardCalls(sb: Sb, workspaceId: string, range: ResolvedRange, filters?: AnalyticsFilters) {
  const rows: any[] = [];
  for (let p = 0; p < CALL_FETCH_MAX_PAGES; p++) {
    let q = sb
      .from("calls")
      .select("id, agent_id, agent_name, call_status, call_successful, sentiment, is_voicemail, in_voicemail, duration_seconds, cost_cents, disconnection_reason, created_at, started_at, lead_id, provider")
      .eq("workspace_id", workspaceId)
      .gte("created_at", range.startIso)
      .lte("created_at", range.endIso)
      .order("created_at", { ascending: false })
      .range(p * CALL_FETCH_PAGE, p * CALL_FETCH_PAGE + CALL_FETCH_PAGE - 1);
    if (filters?.agentId) q = q.eq("agent_id", filters.agentId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as any[];
    rows.push(...batch);
    if (batch.length < CALL_FETCH_PAGE) break;
  }
  return rows;
}

async function fetchWbahCalls(sb: Sb, workspaceId: string, range: ResolvedRange) {
  const rows: any[] = [];
  for (let p = 0; p < CALL_FETCH_MAX_PAGES; p++) {
    const { data, error } = await sb
      .from("wbah_calls")
      .select("id, agent_name, call_status, sentiment, duration_seconds, booking_status, appointment_date, disconnection_reason, started_at, synced_at, call_count")
      .eq("workspace_id", workspaceId)
      .gte("started_at", range.startIso)
      .lte("started_at", range.endIso)
      .order("started_at", { ascending: false })
      .range(p * CALL_FETCH_PAGE, p * CALL_FETCH_PAGE + CALL_FETCH_PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as any[];
    rows.push(...batch);
    if (batch.length < CALL_FETCH_PAGE) break;
  }
  return rows;
}

/**
 * WBAH dialler analytics — aggregates the WeeBespoke dialler activity in
 * wbah_calls (WBAH has no WEBEE campaigns). Paged fetch (wbah_calls exceeds
 * PostgREST's 1000-row cap for a 30d window) with a hard page cap.
 */
export async function getWbahDiallerAnalytics(sb: Sb, workspaceId: string, range: ResolvedRange) {
  const PAGE = 1000;
  const MAX_PAGES = 25;
  const rows: any[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await sb
      .from("wbah_calls")
      .select("id, customer_name, phone, sentiment, call_status, disconnection_reason, end_reason, booking_status, appointment_date, duration_seconds, started_at, meta")
      .eq("workspace_id", workspaceId)
      .gte("started_at", range.startIso)
      .lte("started_at", range.endIso)
      .order("started_at", { ascending: false })
      .range(p * PAGE, p * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as any[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  const isVoicemail = (c: any) => {
    const r = String(c.disconnection_reason ?? c.end_reason ?? "").toLowerCase();
    return r.includes("voicemail");
  };

  // Campaign attribution: match meta.agent_id to the WeeBespoke campaign
  // snapshot; agents shared across campaigns disambiguate by nearest scheduled
  // call time (Europe/London). Best-effort — attribution failure never breaks
  // the aggregates.
  let snapshotCampaigns: any[] = [];
  let attributeCampaign: ((agentId: any, startedAt: any) => any) | null = null;
  try {
    const mod = await import(
      "@/lib/integrations/webespokeEnterprise/wbah-campaign-reporting.server"
    );
    snapshotCampaigns = await mod.loadWbahCampaignSnapshot(sb);
    if (snapshotCampaigns.length > 0) {
      attributeCampaign = (agentId, startedAt) =>
        mod.attributeWbahCampaign(snapshotCampaigns, agentId, startedAt);
    }
  } catch {
    /* snapshot unavailable — skip per-campaign breakdown */
  }
  const byCampaign: Record<string, {
    id: string; name: string; leadStatus: string | null; scheduledTime: string | null;
    calls: number; connected: number; voicemail: number; booked: number;
    positive: number; neutral: number; negative: number;
  }> = {};
  let unattributed = 0;

  let connected = 0, voicemail = 0, positive = 0, neutral = 0, negative = 0, booked = 0;
  const byReason: Record<string, number> = {};
  const byDay: Record<string, { calls: number; connected: number; voicemail: number; positive: number; negative: number }> = {};
  const converted: any[] = [];
  const negatives: any[] = [];

  for (const c of rows) {
    const vm = isVoicemail(c);
    const st = String(c.call_status ?? "").toLowerCase();
    const conn = !vm && (st === "completed" || st === "answered" || st === "connected");
    const s = String(c.sentiment ?? "").toLowerCase();
    const reason = String(c.disconnection_reason ?? c.end_reason ?? "unknown");
    const day = dayKey(c.started_at);

    if (vm) voicemail++;
    if (conn) connected++;
    if (s === "positive") positive++;
    else if (s === "negative") negative++;
    else if (s === "neutral") neutral++;
    if (c.booking_status || c.appointment_date) booked++;
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    if (attributeCampaign) {
      const camp = attributeCampaign((c.meta as any)?.agent_id ?? null, c.started_at);
      if (camp) {
        const entry = (byCampaign[camp.id] ??= {
          id: camp.id,
          name: camp.name,
          leadStatus: camp.lead_status ?? null,
          scheduledTime: camp.call_hour != null
            ? `${String(camp.call_hour).padStart(2, "0")}:${String(camp.call_minute ?? 0).padStart(2, "0")}`
            : null,
          calls: 0, connected: 0, voicemail: 0, booked: 0,
          positive: 0, neutral: 0, negative: 0,
        });
        entry.calls++;
        if (conn) entry.connected++;
        if (vm) entry.voicemail++;
        if (c.booking_status || c.appointment_date) entry.booked++;
        if (s === "positive") entry.positive++;
        else if (s === "negative") entry.negative++;
        else if (s === "neutral") entry.neutral++;
      } else {
        unattributed++;
      }
    }
    if (day) {
      const d = byDay[day] ?? { calls: 0, connected: 0, voicemail: 0, positive: 0, negative: 0 };
      d.calls++; if (conn) d.connected++; if (vm) d.voicemail++;
      if (s === "positive") d.positive++; if (s === "negative") d.negative++;
      byDay[day] = d;
    }
    if (s === "positive" && converted.length < 100) {
      converted.push({
        id: c.id, name: c.customer_name ?? "Unknown", phone: c.phone ?? null,
        booked: Boolean(c.booking_status || c.appointment_date),
        appointmentDate: c.appointment_date ?? null,
        durationSeconds: c.duration_seconds ?? 0, at: c.started_at,
      });
    }
    if (s === "negative" && negatives.length < 100) {
      negatives.push({
        id: c.id, name: c.customer_name ?? "Unknown", phone: c.phone ?? null,
        reason, durationSeconds: c.duration_seconds ?? 0, at: c.started_at,
      });
    }
  }

  const total = rows.length;
  const reasons = Object.entries(byReason)
    .map(([reason, count]) => ({ reason, count, pct: rate(count, total) }))
    .sort((a, b) => b.count - a.count);
  const trend = Object.keys(byDay).sort().map((day) => ({ day, ...byDay[day] }));

  const campaigns = Object.values(byCampaign)
    .map((c) => ({
      ...c,
      connectionRate: rate(c.connected, c.calls),
      voicemailRate: rate(c.voicemail, c.calls),
    }))
    .sort((a, b) => b.calls - a.calls);

  return {
    total, connected, voicemail, booked,
    connectionRate: rate(connected, total),
    voicemailRate: rate(voicemail, total),
    sentiment: { positive, neutral, negative, unknown: total - positive - neutral - negative },
    reasons, trend, converted, negatives,
    campaigns,
    campaignsUnattributed: unattributed,
    truncated: rows.length >= PAGE * MAX_PAGES,
  };
}

// ── Cost helpers ──────────────────────────────────────────────────────────────
async function fetchCostTotals(sb: Sb, workspaceId: string, range: ResolvedRange) {
  const out = {
    profitabilityCents: 0,
    profitabilityRevenueCents: 0,
    profitabilityProfitCents: 0,
    providerCostCents: 0,
    byProvider: {} as Record<string, number>,
    rows: 0,
  };
  try {
    const [{ data: prof }, { data: usage }] = await Promise.all([
      sb.from("call_profitability")
        .select("total_cost_cents, selling_price_cents, profit_cents, created_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", range.startIso).lte("created_at", range.endIso)
        .limit(ROW_CAP),
      sb.from("provider_usage_log")
        .select("provider_category, provider_name, cost_usd, created_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", range.startIso).lte("created_at", range.endIso)
        .limit(ROW_CAP),
    ]);
    for (const r of (prof ?? []) as any[]) {
      out.profitabilityCents += r.total_cost_cents ?? 0;
      out.profitabilityRevenueCents += r.selling_price_cents ?? 0;
      out.profitabilityProfitCents += r.profit_cents ?? 0;
      out.rows++;
    }
    for (const r of (usage ?? []) as any[]) {
      const cents = Math.round((r.cost_usd ?? 0) * 100);
      out.providerCostCents += cents;
      const key = String(r.provider_category ?? "other");
      out.byProvider[key] = (out.byProvider[key] ?? 0) + cents;
    }
  } catch { /* cost data optional */ }
  return out;
}

// ── 1. Executive Overview ─────────────────────────────────────────────────────
export async function getAnalyticsOverviewData(workspaceId: string, filters?: AnalyticsFilters) {
  const sb = supabaseAdmin as any;
  const range = resolveDateRange(filters);
  const isWbah = isWbahWorkspaceId(workspaceId);
  const empty = {
    workspaceId, isWbah, range,
    leads: { total: 0, new: 0, qualified: 0 },
    calls: { total: 0, connected: 0, missed: 0, voicemail: 0, failed: 0 },
    sentiment: { positive: 0, neutral: 0, negative: 0, positiveRate: 0, neutralRate: 0, negativeRate: 0 },
    bookings: 0, callbacks: 0, followUpsCreated: 0,
    rates: { connection: 0, conversion: 0, booking: 0, qualification: 0 },
    cost: { totalCents: 0, perLeadCents: 0, perQualifiedCents: 0, perBookingCents: 0, estRevenueCents: 0, roi: 0 },
    bestCampaign: null as any, worstCampaign: null as any, bestAgent: null as string | null,
    biggestIssue: null as any, nextAction: null as any,
    error: null as string | null,
  };
  try {
    if (isWbah) {
      const calls = await fetchWbahCalls(sb, workspaceId, range);
      let connected = 0, missed = 0, voicemail = 0, failed = 0, pos = 0, neu = 0, neg = 0, bookings = 0;
      for (const c of calls) {
        const st = String(c.call_status ?? "").toLowerCase();
        if (st.includes("voicemail")) voicemail++;
        else if (st === "completed" || st === "answered" || st === "connected") connected++;
        else if (st.includes("no_answer") || st.includes("no-answer") || st === "busy") missed++;
        else if (st === "failed") failed++;
        const s = String(c.sentiment ?? "").toLowerCase();
        if (s === "positive") pos++; else if (s === "negative") neg++; else if (s === "neutral") neu++;
        if (c.booking_status || c.appointment_date) bookings++;
      }
      const total = calls.length;
      return {
        ...empty,
        calls: { total, connected, missed, voicemail, failed },
        sentiment: { positive: pos, neutral: neu, negative: neg, positiveRate: rate(pos, total), neutralRate: rate(neu, total), negativeRate: rate(neg, total) },
        bookings,
        rates: { ...empty.rates, connection: rate(connected, total), booking: rate(bookings, total) },
      };
    }

    const [calls, leadsTotalRes, leadsNewRes, leadsQualRes, bookingsRes, cost, reportsSummaryRes] = await Promise.all([
      fetchStandardCalls(sb, workspaceId, range, filters),
      sb.from("leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
      sb.from("leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId)
        .gte("created_at", range.startIso).lte("created_at", range.endIso),
      sb.from("leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId)
        .eq("qualification_status", "qualified")
        .gte("created_at", range.startIso).lte("created_at", range.endIso),
      sb.from("calendar_bookings").select("id, status, lead_id, created_at", { count: "exact" })
        .eq("workspace_id", workspaceId)
        .gte("created_at", range.startIso).lte("created_at", range.endIso).limit(ROW_CAP),
      fetchCostTotals(sb, workspaceId, range),
      sb.from("campaign_reports")
        .select("report_type, campaign_name, kpi_json, failure_reason, created_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", range.startIso).lte("created_at", range.endIso)
        .order("created_at", { ascending: false }).limit(200),
    ]);

    let connected = 0, missed = 0, voicemail = 0, failed = 0, pos = 0, neu = 0, neg = 0, callbacks = 0;
    const agentCounts: Record<string, { name: string; connected: number; total: number }> = {};
    for (const c of calls) {
      const cls = classifyStandardCall(c);
      if (cls === "connected") connected++;
      else if (cls === "missed") missed++;
      else if (cls === "voicemail") voicemail++;
      else if (cls === "failed") failed++;
      if (c.sentiment === "positive") pos++; else if (c.sentiment === "negative") neg++; else if (c.sentiment === "neutral") neu++;
      const aid = c.agent_id ?? "unknown";
      const ag = agentCounts[aid] ?? { name: c.agent_name ?? aid, connected: 0, total: 0 };
      ag.total++; if (cls === "connected") ag.connected++;
      agentCounts[aid] = ag;
    }
    const total = calls.length;
    const bookings = bookingsRes.count ?? (bookingsRes.data?.length ?? 0);

    // Callbacks + follow-ups (best effort — never fatal).
    let followUpsCreated = 0;
    try {
      const { count: cbCount } = await sb.from("leads").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).eq("callback_requested", true)
        .gte("updated_at", range.startIso).lte("updated_at", range.endIso);
      callbacks = cbCount ?? 0;
      const { count: fuCount } = await sb.from("hivemind_tasks").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).eq("source", "follow_up")
        .gte("created_at", range.startIso).lte("created_at", range.endIso);
      followUpsCreated = fuCount ?? 0;
    } catch { /* optional */ }

    const leadsTotal = leadsTotalRes.count ?? 0;
    const leadsNew = leadsNewRes.count ?? 0;
    const qualified = leadsQualRes.count ?? 0;

    // Best / worst / issue from campaign_reports.
    const reports = (reportsSummaryRes.data ?? []) as any[];
    const kpiRows = reports.filter((r) => r.report_type === "kpi_summary" || r.report_type === "completed");
    const scored = kpiRows.map((r) => {
      const k = (r.kpi_json ?? {}) as any;
      const answered = Number(k.calls_answered ?? 0);
      const ct = Number(k.calls_total ?? 0);
      return { name: r.campaign_name ?? "Campaign", score: rate(answered, ct), kpis: k };
    }).filter((r) => r.kpis && Object.keys(r.kpis).length > 0);
    scored.sort((a, b) => b.score - a.score);
    const bestCampaign = scored[0] ?? null;
    const worstCampaign = scored.length > 1 ? scored[scored.length - 1] : null;
    const failure = reports.find((r) =>
      ["failed", "provider_error", "workflow_error", "safety_blocked", "no_eligible_leads"].includes(r.report_type));
    const biggestIssue = failure
      ? { type: failure.report_type, campaign: failure.campaign_name, reason: failure.failure_reason ?? null, at: failure.created_at }
      : null;

    // Best agent by connection count.
    const bestAgentEntry = Object.values(agentCounts).sort((a, b) => b.connected - a.connected)[0];
    const bestAgent = bestAgentEntry ? bestAgentEntry.name : null;

    // Cost / revenue / ROI.
    const totalCostCents = cost.profitabilityCents > 0 ? cost.profitabilityCents : cost.providerCostCents;
    const estRevenueCents = cost.profitabilityRevenueCents;
    const roi = totalCostCents > 0 ? Math.round(((estRevenueCents - totalCostCents) / totalCostCents) * 1000) / 10 : 0;

    // Next action from a suggested hivemind task (cheap single row).
    let nextAction: any = null;
    try {
      const { data: task } = await sb.from("hivemind_tasks")
        .select("title, description, priority, created_at")
        .eq("workspace_id", workspaceId).eq("status", "suggested")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (task) nextAction = { title: task.title, detail: task.description, priority: task.priority };
    } catch { /* optional */ }

    return {
      workspaceId, isWbah, range,
      leads: { total: leadsTotal, new: leadsNew, qualified },
      calls: { total, connected, missed, voicemail, failed },
      sentiment: {
        positive: pos, neutral: neu, negative: neg,
        positiveRate: rate(pos, total), neutralRate: rate(neu, total), negativeRate: rate(neg, total),
      },
      bookings, callbacks, followUpsCreated,
      rates: {
        connection: rate(connected, total),
        conversion: rate(qualified, leadsNew),
        booking: rate(bookings, total),
        qualification: rate(qualified, leadsNew),
      },
      cost: {
        totalCents: totalCostCents,
        perLeadCents: leadsNew > 0 ? Math.round(totalCostCents / leadsNew) : 0,
        perQualifiedCents: qualified > 0 ? Math.round(totalCostCents / qualified) : 0,
        perBookingCents: bookings > 0 ? Math.round(totalCostCents / bookings) : 0,
        estRevenueCents, roi,
      },
      bestCampaign, worstCampaign, bestAgent, biggestIssue, nextAction,
      error: null,
    };
  } catch (err: any) {
    return { ...empty, error: err?.message ?? "Analytics unavailable" };
  }
}

// ── 2. Campaign Analytics ─────────────────────────────────────────────────────
export async function getCampaignAnalyticsData(
  workspaceId: string,
  filters?: AnalyticsFilters,
  opts?: { compareIds?: string[] },
) {
  const sb = supabaseAdmin as any;
  const range = resolveDateRange(filters);
  const base = { workspaceId, range, campaigns: [] as any[], failures: [] as any[], schedule: [] as any[], compare: null as any, mode: "standard" as "standard" | "wbah_dialler", wbah: null as any, error: null as string | null };
  if (isWbahWorkspaceId(workspaceId)) {
    // WBAH runs its calling on the external WeeBespoke dialler, not WEBEE
    // campaigns — report on the dialler activity from wbah_calls instead.
    try {
      const wbah = await getWbahDiallerAnalytics(sb, workspaceId, range);
      return { ...base, mode: "wbah_dialler" as const, wbah };
    } catch (err: any) {
      return { ...base, mode: "wbah_dialler" as const, error: err?.message ?? "Dialler analytics unavailable" };
    }
  }
  try {
    let cq = sb.from("campaigns")
      .select("id, name, status, agent_id, created_at, updated_at, stats, description")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (opts?.compareIds && opts.compareIds.length > 0) cq = cq.in("id", opts.compareIds);
    if (filters?.campaignId) cq = cq.eq("id", filters.campaignId);
    if (filters?.agentId) cq = cq.eq("agent_id", filters.agentId);
    const { data: campaigns } = await cq;

    const { data: reports } = await sb.from("campaign_reports")
      .select("campaign_id, report_type, campaign_name, agent_name, kpi_json, failure_reason, failure_stage, error_message, recommended_actions_json, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(500);
    const reportRows = (reports ?? []) as any[];
    const latestKpiByCampaign: Record<string, any> = {};
    for (const r of reportRows) {
      if (!r.campaign_id) continue;
      if (!latestKpiByCampaign[r.campaign_id] && (r.report_type === "kpi_summary" || r.report_type === "completed" || r.report_type === "run_summary")) {
        latestKpiByCampaign[r.campaign_id] = r.kpi_json ?? {};
      }
    }

    const rows = ((campaigns ?? []) as any[]).map((c) => {
      const k = (latestKpiByCampaign[c.id] ?? (c.stats ?? {})) as any;
      const callsTotal = Number(k.calls_total ?? 0);
      const answered = Number(k.calls_answered ?? 0);
      const costCents = Number(k.total_cost_cents ?? 0);
      return {
        id: c.id, name: c.name, status: c.status, agentId: c.agent_id,
        launchedAt: c.created_at, completedAt: c.status === "completed" ? c.updated_at : null,
        callsTotal, callsConnected: answered,
        callsVoicemail: Number(k.calls_voicemail ?? 0), callsFailed: Number(k.calls_failed ?? 0),
        positiveSentiment: Number(k.positive_sentiment ?? 0),
        avgDurationSeconds: Number(k.avg_duration_seconds ?? 0),
        totalCostCents: costCents,
        connectionRate: rate(answered, callsTotal),
        costPerCallCents: callsTotal > 0 ? Math.round(costCents / callsTotal) : 0,
        costPerConnectedCents: answered > 0 ? Math.round(costCents / answered) : 0,
      };
    });

    const failures = reportRows
      .filter((r) => ["failed", "provider_error", "workflow_error", "safety_blocked", "no_eligible_leads"].includes(r.report_type))
      .slice(0, 50)
      .map((r) => ({
        campaignId: r.campaign_id, campaign: r.campaign_name, type: r.report_type,
        reason: r.failure_reason, stage: r.failure_stage, error: r.error_message,
        recommendations: r.recommended_actions_json ?? [], at: r.created_at,
      }));

    const compare = opts?.compareIds && opts.compareIds.length > 0
      ? rows.filter((r) => opts.compareIds!.includes(r.id))
      : null;

    // ── Today's schedule — scheduled (__sched_v1__) campaigns and whether they
    //    run today (already ran / still due / not due this interval). ──
    const { parseConfig } = await import("@/lib/campaign-scheduler/executor");
    const schedule = ((campaigns ?? []) as any[])
      .map((c) => {
        const cfg = parseConfig(c.description ?? null);
        if (!cfg) return null;
        const tz = cfg.timezone || "UTC";
        let today: string;
        try {
          today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
        } catch {
          today = new Date().toISOString().slice(0, 10);
        }
        const ranToday = cfg.lastRunDate === today;
        let dueToday = true;
        if (cfg.callFrequency === "custom" && cfg.lastRunDate && !ranToday) {
          const msPerDay = 86_400_000;
          const last = new Date(cfg.lastRunDate + "T00:00:00Z").getTime();
          const now = new Date(today + "T00:00:00Z").getTime();
          dueToday = (now - last) / msPerDay >= Math.max(1, cfg.intervalDays || 1);
        }
        const active = String(c.status ?? "").toLowerCase() === "active";
        return {
          id: c.id,
          name: c.name,
          status: c.status,
          active,
          callTime: cfg.callTime,
          timezone: tz,
          frequency: cfg.callFrequency === "custom" ? `every ${Math.max(1, cfg.intervalDays || 1)} days` : "daily",
          lastRunDate: cfg.lastRunDate ?? null,
          ranToday,
          runsToday: active && !ranToday && dueToday,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => String(a.callTime).localeCompare(String(b.callTime)));

    return { ...base, campaigns: rows, failures, schedule, compare };
  } catch (err: any) {
    return { ...base, error: err?.message ?? "Campaign analytics unavailable" };
  }
}

// ── 3. Agent Analytics ────────────────────────────────────────────────────────
export async function getAgentAnalyticsData(workspaceId: string, filters?: AnalyticsFilters) {
  const sb = supabaseAdmin as any;
  const range = resolveDateRange(filters);
  const base = { workspaceId, range, agents: [] as any[], error: null as string | null };
  try {
    const isWbah = isWbahWorkspaceId(workspaceId);
    const calls = isWbah ? await fetchWbahCalls(sb, workspaceId, range) : await fetchStandardCalls(sb, workspaceId, range, filters);
    const map: Record<string, any> = {};
    let costByAgent: Record<string, number> = {};
    if (!isWbah) {
      try {
        const { data: prof } = await sb.from("call_profitability")
          .select("agent_id, total_cost_cents, created_at")
          .eq("workspace_id", workspaceId)
          .gte("created_at", range.startIso).lte("created_at", range.endIso).limit(ROW_CAP);
        for (const p of (prof ?? []) as any[]) {
          const aid = p.agent_id ?? "unknown";
          costByAgent[aid] = (costByAgent[aid] ?? 0) + (p.total_cost_cents ?? 0);
        }
      } catch { /* optional */ }
    }
    for (const c of calls) {
      const aid = isWbah ? (c.agent_name ?? "unknown") : (c.agent_id ?? "unknown");
      const name = isWbah ? (c.agent_name ?? "Agent") : (c.agent_name ?? aid);
      const a = map[aid] ?? {
        agentId: aid, name, total: 0, connected: 0, missed: 0, voicemail: 0, failed: 0,
        positive: 0, neutral: 0, negative: 0, durationSum: 0, bookings: 0,
      };
      a.total++;
      if (isWbah) {
        const st = String(c.call_status ?? "").toLowerCase();
        if (st.includes("voicemail")) a.voicemail++;
        else if (st === "completed" || st === "answered" || st === "connected") a.connected++;
        else if (st.includes("no_answer") || st === "busy") a.missed++;
        else if (st === "failed") a.failed++;
        const s = String(c.sentiment ?? "").toLowerCase();
        if (s === "positive") a.positive++; else if (s === "negative") a.negative++; else if (s === "neutral") a.neutral++;
        if (c.booking_status || c.appointment_date) a.bookings++;
      } else {
        const cls = classifyStandardCall(c);
        if (cls === "connected") a.connected++;
        else if (cls === "missed") a.missed++;
        else if (cls === "voicemail") a.voicemail++;
        else if (cls === "failed") a.failed++;
        if (c.sentiment === "positive") a.positive++; else if (c.sentiment === "negative") a.negative++; else if (c.sentiment === "neutral") a.neutral++;
      }
      a.durationSum += Number(c.duration_seconds ?? 0);
      map[aid] = a;
    }
    const agents = Object.values(map).map((a: any) => {
      const costCents = costByAgent[a.agentId] ?? 0;
      return {
        agentId: a.agentId, name: a.name, total: a.total,
        connected: a.connected, missed: a.missed, voicemail: a.voicemail, failed: a.failed,
        connectionRate: rate(a.connected, a.total),
        positiveRate: rate(a.positive, a.total), neutralRate: rate(a.neutral, a.total), negativeRate: rate(a.negative, a.total),
        bookings: a.bookings, bookingRate: rate(a.bookings, a.total),
        avgDurationSeconds: a.total > 0 ? Math.round(a.durationSum / a.total) : 0,
        totalCostCents: costCents,
        costPerConnectedCents: a.connected > 0 ? Math.round(costCents / a.connected) : 0,
      };
    }).sort((x, y) => y.total - x.total);
    return { ...base, agents };
  } catch (err: any) {
    return { ...base, error: err?.message ?? "Agent analytics unavailable" };
  }
}

// ── 4. Lead Source Analytics ──────────────────────────────────────────────────
export async function getLeadSourceAnalyticsData(workspaceId: string, filters?: AnalyticsFilters) {
  const sb = supabaseAdmin as any;
  const range = resolveDateRange(filters);
  const base = { workspaceId, range, sources: [] as any[], error: null as string | null };
  if (isWbahWorkspaceId(workspaceId)) return { ...base, error: "not_available_for_wbah" };
  try {
    // Bounded fetch of leads created in window (NOT the whole 400k table — window + cap).
    const { data: leads } = await sb.from("leads")
      .select("id, source, qualification_status, callback_requested, created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", range.startIso).lte("created_at", range.endIso)
      .order("created_at", { ascending: false })
      .limit(ROW_CAP);
    const rows = (leads ?? []) as any[];
    const map: Record<string, any> = {};
    for (const l of rows) {
      const src = String(l.source ?? "unknown");
      const s = map[src] ?? { source: src, leads: 0, qualified: 0, callbacks: 0 };
      s.leads++;
      if (l.qualification_status === "qualified") s.qualified++;
      if (l.callback_requested === true) s.callbacks++;
      map[src] = s;
    }
    const cost = await fetchCostTotals(sb, workspaceId, range);
    const totalLeads = rows.length;
    const perLeadCents = totalLeads > 0 ? Math.round((cost.profitabilityCents || cost.providerCostCents) / totalLeads) : 0;
    const sources = Object.values(map).map((s: any) => ({
      source: s.source, leads: s.leads, qualified: s.qualified, callbacks: s.callbacks,
      qualifiedRate: rate(s.qualified, s.leads),
      callbackRate: rate(s.callbacks, s.leads),
      costPerLeadCents: perLeadCents,
    })).sort((a, b) => b.leads - a.leads);
    const best = [...sources].sort((a, b) => b.qualifiedRate - a.qualifiedRate)[0]?.source ?? null;
    const worst = sources.length > 1 ? [...sources].sort((a, b) => a.qualifiedRate - b.qualifiedRate)[0]?.source ?? null : null;
    return { ...base, sources, bestSource: best, worstSource: worst };
  } catch (err: any) {
    return { ...base, error: err?.message ?? "Lead source analytics unavailable" };
  }
}

// ── 5. Call Analytics (deep) ──────────────────────────────────────────────────
export async function getCallAnalyticsDeepData(workspaceId: string, filters?: AnalyticsFilters) {
  const sb = supabaseAdmin as any;
  const range = resolveDateRange(filters);
  const base = {
    workspaceId, range,
    volumeByDay: [] as Array<{ day: string; count: number }>,
    volumeByHour: [] as Array<{ hour: number; count: number }>,
    rates: { connection: 0, noAnswer: 0, voicemail: 0, failure: 0 },
    duration: { avgSeconds: 0, maxSeconds: 0, minSeconds: 0 },
    bestHour: null as number | null, worstHour: null as number | null,
    total: 0, error: null as string | null,
  };
  try {
    const isWbah = isWbahWorkspaceId(workspaceId);
    const calls = isWbah ? await fetchWbahCalls(sb, workspaceId, range) : await fetchStandardCalls(sb, workspaceId, range, filters);
    const byDay: Record<string, number> = {};
    const byHour: Record<number, number> = {};
    const connByHour: Record<number, { c: number; t: number }> = {};
    let connected = 0, missed = 0, voicemail = 0, failed = 0;
    let durSum = 0, durMax = 0, durMin = Number.MAX_SAFE_INTEGER, durCount = 0;
    for (const c of calls) {
      const startIso = isWbah ? c.started_at : (c.started_at ?? c.created_at);
      const dk = dayKey(startIso);
      if (dk) byDay[dk] = (byDay[dk] ?? 0) + 1;
      let hr: number | null = null;
      if (startIso) { const d = new Date(startIso); if (!isNaN(d.getTime())) hr = d.getUTCHours(); }
      if (hr !== null) byHour[hr] = (byHour[hr] ?? 0) + 1;
      let cls: string;
      if (isWbah) {
        const st = String(c.call_status ?? "").toLowerCase();
        cls = st.includes("voicemail") ? "voicemail"
          : (st === "completed" || st === "answered" || st === "connected") ? "connected"
          : (st.includes("no_answer") || st === "busy") ? "missed"
          : st === "failed" ? "failed" : "other";
      } else cls = classifyStandardCall(c);
      if (cls === "connected") connected++;
      else if (cls === "missed") missed++;
      else if (cls === "voicemail") voicemail++;
      else if (cls === "failed") failed++;
      if (hr !== null) {
        const ch = connByHour[hr] ?? { c: 0, t: 0 }; ch.t++; if (cls === "connected") ch.c++; connByHour[hr] = ch;
      }
      const dur = Number(c.duration_seconds ?? 0);
      if (dur > 0) { durSum += dur; durCount++; durMax = Math.max(durMax, dur); durMin = Math.min(durMin, dur); }
    }
    const total = calls.length;
    const hourEntries = Object.entries(connByHour).map(([h, v]) => ({ hour: Number(h), connRate: rate(v.c, v.t), t: v.t }))
      .filter((e) => e.t >= 3).sort((a, b) => b.connRate - a.connRate);
    return {
      ...base, total,
      volumeByDay: Object.entries(byDay).map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day)),
      volumeByHour: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: byHour[h] ?? 0 })),
      rates: { connection: rate(connected, total), noAnswer: rate(missed, total), voicemail: rate(voicemail, total), failure: rate(failed, total) },
      duration: { avgSeconds: durCount > 0 ? Math.round(durSum / durCount) : 0, maxSeconds: durMax, minSeconds: durMin === Number.MAX_SAFE_INTEGER ? 0 : durMin },
      bestHour: hourEntries[0]?.hour ?? null,
      worstHour: hourEntries.length > 1 ? hourEntries[hourEntries.length - 1].hour : null,
    };
  } catch (err: any) {
    return { ...base, error: err?.message ?? "Call analytics unavailable" };
  }
}

// ── 6. Sentiment Analytics ────────────────────────────────────────────────────
export async function getSentimentAnalyticsData(workspaceId: string, filters?: AnalyticsFilters) {
  const sb = supabaseAdmin as any;
  const range = resolveDateRange(filters);
  const base = {
    workspaceId, range,
    counts: { positive: 0, neutral: 0, negative: 0, unknown: 0 },
    rates: { positive: 0, neutral: 0, negative: 0 },
    byAgent: [] as any[], byDay: [] as any[], bySource: [] as any[],
    negativeReasons: [] as Array<{ reason: string; count: number }>,
    total: 0, error: null as string | null,
  };
  try {
    const isWbah = isWbahWorkspaceId(workspaceId);
    const calls = isWbah ? await fetchWbahCalls(sb, workspaceId, range) : await fetchStandardCalls(sb, workspaceId, range, filters);
    let pos = 0, neu = 0, neg = 0, unk = 0;
    const byAgent: Record<string, { name: string; pos: number; neg: number; total: number }> = {};
    const byDay: Record<string, { pos: number; neg: number; neu: number }> = {};
    for (const c of calls) {
      const s = String(c.sentiment ?? "").toLowerCase();
      if (s === "positive") pos++; else if (s === "negative") neg++; else if (s === "neutral") neu++; else unk++;
      const aid = isWbah ? (c.agent_name ?? "unknown") : (c.agent_id ?? "unknown");
      const name = isWbah ? (c.agent_name ?? "Agent") : (c.agent_name ?? aid);
      const a = byAgent[aid] ?? { name, pos: 0, neg: 0, total: 0 };
      a.total++; if (s === "positive") a.pos++; else if (s === "negative") a.neg++;
      byAgent[aid] = a;
      const dk = dayKey(isWbah ? c.started_at : (c.started_at ?? c.created_at));
      if (dk) { const d = byDay[dk] ?? { pos: 0, neg: 0, neu: 0 }; if (s === "positive") d.pos++; else if (s === "negative") d.neg++; else if (s === "neutral") d.neu++; byDay[dk] = d; }
    }
    const total = calls.length;
    return {
      ...base, total,
      counts: { positive: pos, neutral: neu, negative: neg, unknown: unk },
      rates: { positive: rate(pos, total), neutral: rate(neu, total), negative: rate(neg, total) },
      byAgent: Object.values(byAgent).map((a: any) => ({ name: a.name, positiveRate: rate(a.pos, a.total), negativeRate: rate(a.neg, a.total), total: a.total })).sort((x, y) => y.total - x.total),
      byDay: Object.entries(byDay).map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
    };
  } catch (err: any) {
    return { ...base, error: err?.message ?? "Sentiment analytics unavailable" };
  }
}

// ── 7. Booking Analytics ──────────────────────────────────────────────────────
export async function getBookingAnalyticsData(workspaceId: string, filters?: AnalyticsFilters) {
  const sb = supabaseAdmin as any;
  const range = resolveDateRange(filters);
  const base = {
    workspaceId, range, total: 0,
    byStatus: {} as Record<string, number>,
    bySource: [] as Array<{ source: string; count: number }>,
    byDay: [] as Array<{ day: string; count: number }>,
    anomalies: { count: 0, sampleLeadIds: [] as string[] },
    error: null as string | null,
  };
  try {
    if (isWbahWorkspaceId(workspaceId)) {
      const calls = await fetchWbahCalls(sb, workspaceId, range);
      let total = 0; const byDay: Record<string, number> = {}; const byStatus: Record<string, number> = {};
      for (const c of calls) {
        if (c.booking_status || c.appointment_date) {
          total++;
          const st = String(c.booking_status ?? "booked");
          byStatus[st] = (byStatus[st] ?? 0) + 1;
          const dk = dayKey(c.appointment_date ?? c.started_at);
          if (dk) byDay[dk] = (byDay[dk] ?? 0) + 1;
        }
      }
      return { ...base, total, byStatus, byDay: Object.entries(byDay).map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day)) };
    }
    const { data: bookings } = await sb.from("calendar_bookings")
      .select("id, status, source, start_at, created_at, lead_id")
      .eq("workspace_id", workspaceId)
      .gte("created_at", range.startIso).lte("created_at", range.endIso)
      .order("created_at", { ascending: false }).limit(ROW_CAP);
    const rows = (bookings ?? []) as any[];
    const byStatus: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const byDay: Record<string, number> = {};
    for (const b of rows) {
      const st = String(b.status ?? "pending"); byStatus[st] = (byStatus[st] ?? 0) + 1;
      const src = String(b.source ?? "unknown"); bySource[src] = (bySource[src] ?? 0) + 1;
      const dk = dayKey(b.created_at); if (dk) byDay[dk] = (byDay[dk] ?? 0) + 1;
    }

    // Booking anomaly: a lead still marked "need_to_call" despite an existing
    // booking (calendar_bookings row). Mirrors the booking detection above
    // (calendar_bookings.lead_id) — never row-fetches the giant leads table:
    // we only look up the specific booked lead ids (bounded to ROW_CAP rows).
    const anomalies = { count: 0, sampleLeadIds: [] as string[] };
    try {
      const bookedLeadIds = Array.from(new Set(rows.map((b) => b.lead_id).filter(Boolean))) as string[];
      if (bookedLeadIds.length > 0) {
        const { data: staleLeads } = await sb.from("leads")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("status", "need_to_call")
          .in("id", bookedLeadIds.slice(0, ROW_CAP))
          .limit(ROW_CAP);
        const ids = ((staleLeads ?? []) as any[]).map((l) => String(l.id));
        anomalies.count = ids.length;
        anomalies.sampleLeadIds = ids.slice(0, 20);
      }
    } catch { /* anomaly detection optional */ }

    return {
      ...base, total: rows.length, byStatus, anomalies,
      bySource: Object.entries(bySource).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
      byDay: Object.entries(byDay).map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day)),
    };
  } catch (err: any) {
    return { ...base, error: err?.message ?? "Booking analytics unavailable" };
  }
}

// ── 8. Workflow Analytics ─────────────────────────────────────────────────────
export async function getWorkflowAnalyticsData(workspaceId: string, filters?: AnalyticsFilters) {
  const sb = supabaseAdmin as any;
  const range = resolveDateRange(filters);
  const base = { workspaceId, range, workflows: [] as any[], error: null as string | null };
  if (isWbahWorkspaceId(workspaceId)) return { ...base, error: "not_available_for_wbah" };
  try {
    const [{ data: workflows }, { data: runs }] = await Promise.all([
      sb.from("workspace_workflows").select("id, name, status, trigger_type").eq("workspace_id", workspaceId).limit(200),
      sb.from("workflow_runs").select("workflow_id, status, error, started_at, completed_at")
        .eq("workspace_id", workspaceId)
        .gte("started_at", range.startIso).lte("started_at", range.endIso)
        .order("started_at", { ascending: false }).limit(ROW_CAP),
    ]);
    const wfMap: Record<string, any> = {};
    for (const w of (workflows ?? []) as any[]) {
      wfMap[w.id] = { id: w.id, name: w.name, status: w.status, triggerType: w.trigger_type, triggers: 0, success: 0, failure: 0, lastRun: null as string | null, lastFailure: null as string | null, errors: {} as Record<string, number> };
    }
    for (const r of (runs ?? []) as any[]) {
      const w = wfMap[r.workflow_id]; if (!w) continue;
      w.triggers++;
      if (r.status === "completed" || r.status === "success") w.success++;
      else if (r.status === "failed" || r.status === "error") { w.failure++; if (r.error) w.errors[r.error] = (w.errors[r.error] ?? 0) + 1; if (!w.lastFailure) w.lastFailure = r.started_at; }
      if (!w.lastRun) w.lastRun = r.started_at;
    }
    const rows = Object.values(wfMap).map((w: any) => ({
      id: w.id, name: w.name, status: w.status, triggerType: w.triggerType,
      triggers: w.triggers, success: w.success, failure: w.failure,
      successRate: rate(w.success, w.triggers), failureRate: rate(w.failure, w.triggers),
      lastRun: w.lastRun, lastFailure: w.lastFailure,
      commonErrors: Object.entries(w.errors).map(([error, count]) => ({ error, count })).sort((a: any, b: any) => b.count - a.count).slice(0, 5),
    })).sort((a, b) => b.triggers - a.triggers);
    return { ...base, workflows: rows };
  } catch (err: any) {
    return { ...base, error: err?.message ?? "Workflow analytics unavailable" };
  }
}

// ── 9. Follow-up Analytics ────────────────────────────────────────────────────
export async function getFollowUpAnalyticsData(workspaceId: string, filters?: AnalyticsFilters) {
  const sb = supabaseAdmin as any;
  const range = resolveDateRange(filters);
  const base = {
    workspaceId, range,
    created: 0, completed: 0, overdue: 0,
    byChannel: [] as Array<{ channel: string; count: number }>,
    error: null as string | null,
  };
  if (isWbahWorkspaceId(workspaceId)) return { ...base, error: "not_available_for_wbah" };
  try {
    const nowIso = new Date().toISOString();
    const [createdRes, completedRes, overdueRes, tasksRes] = await Promise.all([
      sb.from("hivemind_tasks").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).eq("source", "follow_up")
        .gte("created_at", range.startIso).lte("created_at", range.endIso),
      sb.from("hivemind_tasks").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).eq("source", "follow_up").eq("status", "completed")
        .gte("updated_at", range.startIso).lte("updated_at", range.endIso),
      sb.from("hivemind_tasks").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).eq("source", "follow_up").neq("status", "completed")
        .lt("due_date", nowIso),
      sb.from("hivemind_tasks").select("trigger_type, metadata")
        .eq("workspace_id", workspaceId).eq("source", "follow_up")
        .gte("created_at", range.startIso).lte("created_at", range.endIso).limit(ROW_CAP),
    ]);
    const byChannel: Record<string, number> = {};
    for (const t of (tasksRes.data ?? []) as any[]) {
      const meta = (t.metadata ?? {}) as any;
      const ch = String(meta.channel ?? t.trigger_type ?? "task");
      byChannel[ch] = (byChannel[ch] ?? 0) + 1;
    }
    return {
      ...base,
      created: createdRes.count ?? 0,
      completed: completedRes.count ?? 0,
      overdue: overdueRes.count ?? 0,
      byChannel: Object.entries(byChannel).map(([channel, count]) => ({ channel, count })).sort((a, b) => b.count - a.count),
    };
  } catch (err: any) {
    return { ...base, error: err?.message ?? "Follow-up analytics unavailable" };
  }
}

// ── 10. Financial Analytics ───────────────────────────────────────────────────
export async function getFinancialAnalyticsData(workspaceId: string, filters?: AnalyticsFilters) {
  const sb = supabaseAdmin as any;
  const range = resolveDateRange(filters);
  const base = {
    workspaceId, range,
    minutesUsed: 0, minutesRemaining: null as number | null,
    costCents: 0, providerCostsCents: {} as Record<string, number>,
    revenueCents: 0, profitCents: 0, roi: 0, marginPercent: 0,
    costPerLeadCents: 0, costPerQualifiedCents: 0, costPerBookingCents: 0,
    costTrend: [] as Array<{ day: string; costCents: number }>,
    packageLimits: null as any,
    error: null as string | null,
  };
  try {
    const cost = await fetchCostTotals(sb, workspaceId, range);
    const isWbah = isWbahWorkspaceId(workspaceId);
    const calls = isWbah ? await fetchWbahCalls(sb, workspaceId, range) : await fetchStandardCalls(sb, workspaceId, range, filters);
    let durSum = 0;
    for (const c of calls) durSum += Number(c.duration_seconds ?? 0);
    const minutesUsed = Math.round(durSum / 60);

    // Cost trend by day (from profitability rows).
    const trend: Record<string, number> = {};
    try {
      const { data: prof } = await sb.from("call_profitability")
        .select("total_cost_cents, created_at").eq("workspace_id", workspaceId)
        .gte("created_at", range.startIso).lte("created_at", range.endIso).limit(ROW_CAP);
      for (const p of (prof ?? []) as any[]) {
        const dk = dayKey(p.created_at); if (dk) trend[dk] = (trend[dk] ?? 0) + (p.total_cost_cents ?? 0);
      }
    } catch { /* optional */ }

    const totalCostCents = cost.profitabilityCents > 0 ? cost.profitabilityCents : cost.providerCostCents;
    const revenueCents = cost.profitabilityRevenueCents;
    const profitCents = cost.profitabilityProfitCents || (revenueCents - totalCostCents);
    const roi = totalCostCents > 0 ? Math.round(((revenueCents - totalCostCents) / totalCostCents) * 1000) / 10 : 0;
    const marginPercent = revenueCents > 0 ? Math.round((profitCents / revenueCents) * 1000) / 10 : 0;

    // Cost per lead / qualified / booking (window counts).
    let leadsNew = 0, qualified = 0, bookings = 0;
    if (!isWbah) {
      const [ln, qn, bn] = await Promise.all([
        sb.from("leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("created_at", range.startIso).lte("created_at", range.endIso),
        sb.from("leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("qualification_status", "qualified").gte("created_at", range.startIso).lte("created_at", range.endIso),
        sb.from("calendar_bookings").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("created_at", range.startIso).lte("created_at", range.endIso),
      ]);
      leadsNew = ln.count ?? 0; qualified = qn.count ?? 0; bookings = bn.count ?? 0;
    }

    // Package limits (best effort).
    let packageLimits: any = null;
    try {
      const { getWorkspaceEntitlements } = await import("@/lib/packages/entitlements.server");
      const ent = await getWorkspaceEntitlements(workspaceId);
      packageLimits = { packageName: ent.packageName, includedVoiceMinutes: ent.limits.includedVoiceMinutes ?? null, minutesUsed };
    } catch { /* optional */ }

    return {
      ...base,
      minutesUsed,
      costCents: totalCostCents,
      providerCostsCents: cost.byProvider,
      revenueCents, profitCents, roi, marginPercent,
      costPerLeadCents: leadsNew > 0 ? Math.round(totalCostCents / leadsNew) : 0,
      costPerQualifiedCents: qualified > 0 ? Math.round(totalCostCents / qualified) : 0,
      costPerBookingCents: bookings > 0 ? Math.round(totalCostCents / bookings) : 0,
      costTrend: Object.entries(trend).map(([day, costCents]) => ({ day, costCents })).sort((a, b) => a.day.localeCompare(b.day)),
      packageLimits,
    };
  } catch (err: any) {
    return { ...base, error: err?.message ?? "Financial analytics unavailable" };
  }
}

// ── 11. Lead Analytics ────────────────────────────────────────────────────────
/**
 * Lead-focused analytics: counts by status/source, new vs qualified, and
 * conversion-to-booking. Uses count(head:true) buckets only — never row-fetches
 * the giant leads table. Status/source buckets iterate the static enum lists.
 */
export async function getLeadAnalyticsData(workspaceId: string, filters?: AnalyticsFilters) {
  const sb = supabaseAdmin as any;
  const range = resolveDateRange(filters);
  const base = {
    workspaceId, range,
    total: 0, newInRange: 0, qualified: 0, bookings: 0,
    byStatus: [] as Array<{ status: string; count: number }>,
    bySource: [] as Array<{ source: string; count: number }>,
    conversionRate: 0, qualificationRate: 0,
    error: null as string | null,
  };
  if (isWbahWorkspaceId(workspaceId)) return { ...base, error: "not_available_for_wbah" };
  try {
    const countWindow = (extra: (q: any) => any) =>
      extra(sb.from("leads").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .gte("created_at", range.startIso).lte("created_at", range.endIso));

    const srcFilter = filters?.source ?? null;

    const [newRes, qualRes, bookingsRes, statusResults, sourceResults] = await Promise.all([
      countWindow((q: any) => (srcFilter ? q.eq("source", srcFilter) : q)),
      countWindow((q: any) => { let x = q.eq("qualification_status", "qualified"); if (srcFilter) x = x.eq("source", srcFilter); return x; })
        .then((r: any) => r, () => ({ count: 0 })),
      sb.from("calendar_bookings").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .gte("created_at", range.startIso).lte("created_at", range.endIso),
      Promise.all(LEAD_STATUS_VALUES.map((st) =>
        countWindow((q: any) => { let x = q.eq("status", st); if (srcFilter) x = x.eq("source", srcFilter); return x; })
          .then((r: any) => ({ status: st, count: r.count ?? 0 }), () => ({ status: st, count: 0 })))),
      Promise.all((srcFilter ? [srcFilter] : LEAD_SOURCE_VALUES).map((src) =>
        countWindow((q: any) => q.eq("source", src))
          .then((r: any) => ({ source: src, count: r.count ?? 0 }), () => ({ source: src, count: 0 })))),
    ]);

    const newInRange = newRes.count ?? 0;
    const qualified = qualRes.count ?? 0;
    const bookings = bookingsRes.count ?? 0;
    const byStatus = statusResults.filter((s: any) => s.count > 0).sort((a: any, b: any) => b.count - a.count);
    const bySource = sourceResults.filter((s: any) => s.count > 0).sort((a: any, b: any) => b.count - a.count);

    return {
      ...base,
      total: newInRange, newInRange, qualified, bookings,
      byStatus, bySource,
      conversionRate: rate(bookings, newInRange),
      qualificationRate: rate(qualified, newInRange),
    };
  } catch (err: any) {
    return { ...base, error: err?.message ?? "Lead analytics unavailable" };
  }
}

// ── Filter options (agents / campaigns / lead sources) ────────────────────────
/**
 * Options for the shared analytics FilterBar. Agents from the agents table,
 * campaigns from the campaigns table (bounded), sources from the static
 * lead_source enum list (never scans the giant leads table). Fails closed.
 */
export async function getAnalyticsFilterOptionsData(workspaceId: string) {
  const sb = supabaseAdmin as any;
  const base = {
    workspaceId,
    agents: [] as Array<{ id: string; name: string }>,
    campaigns: [] as Array<{ id: string; name: string }>,
    sources: LEAD_SOURCE_VALUES.map((s) => ({ value: s, label: s.replace(/_/g, " ") })),
    error: null as string | null,
  };
  if (isWbahWorkspaceId(workspaceId)) return { ...base, error: "not_available_for_wbah" };
  try {
    const [{ data: agents }, { data: campaigns }] = await Promise.all([
      sb.from("agents").select("id, name").eq("workspace_id", workspaceId).order("name", { ascending: true }).limit(200),
      sb.from("campaigns").select("id, name").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    ]);
    return {
      ...base,
      agents: ((agents ?? []) as any[]).map((a) => ({ id: String(a.id), name: String(a.name ?? a.id) })),
      campaigns: ((campaigns ?? []) as any[]).map((c) => ({ id: String(c.id), name: String(c.name ?? c.id) })),
    };
  } catch (err: any) {
    return { ...base, error: err?.message ?? "Filter options unavailable" };
  }
}

// ── Compact snapshot for exec context builders ────────────────────────────────
/**
 * Plain async — NOT a server fn. Returns a small, cheap overview for HiveMind /
 * GrowthMind / AccountsMind / SystemMind context builders. Never throws.
 */
export async function getAnalyticsSnapshotForExec(workspaceId: string) {
  try {
    const overview = await getAnalyticsOverviewData(workspaceId, { dateFilter: "30d" });
    return {
      windowDays: overview.range.days,
      leads: overview.leads,
      calls: overview.calls,
      sentiment: overview.sentiment,
      bookings: overview.bookings,
      rates: overview.rates,
      cost: { totalCents: overview.cost.totalCents, roi: overview.cost.roi, estRevenueCents: overview.cost.estRevenueCents },
      bestCampaign: overview.bestCampaign?.name ?? null,
      worstCampaign: overview.worstCampaign?.name ?? null,
      bestAgent: overview.bestAgent,
      biggestIssue: overview.biggestIssue,
      nextAction: overview.nextAction,
      error: overview.error,
    };
  } catch (err: any) {
    return { windowDays: 30, error: err?.message ?? "snapshot unavailable" };
  }
}

// Re-exported currency helper for callers that want to format cents.
export { centsToPounds, safeDiv, rate };
