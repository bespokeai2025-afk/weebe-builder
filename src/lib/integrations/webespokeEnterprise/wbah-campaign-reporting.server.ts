/**
 * WBAH dialler campaign reporting (server-only).
 *
 * The WeeBespoke dialler runs scheduled campaigns (e.g. "9 AM TTC Sweep") that
 * share Retell agents. This module:
 *
 *   • loads the campaign snapshot (wbah_campaign_snapshot — refreshed
 *     opportunistically whenever the WBAH campaigns page does a live read;
 *     NEVER by background polling, WeeBespoke is single-session)
 *   • attributes each wbah_calls row to a campaign via agent_id + nearest
 *     scheduled call_hour (Europe/London)
 *   • runs the start/finish tick: emits a "campaign started" report when a
 *     scheduled campaign window opens, and a "campaign finished" report with
 *     full KPIs once dialling goes quiet (detected from wbah_calls, fed by
 *     WBAH's OWN Retell API — no WeeBespoke session involved).
 */
import { WBAH_WORKSPACE_ID } from "@/lib/wbah-exclusion.shared";

type Sb = any;

export interface WbahCampaignSnapshotRow {
  id: string;
  workspace_id: string;
  name: string;
  status: string | null;
  agent_id: string | null;
  lead_status: string | null;
  call_hour: number | null;
  call_minute: number | null;
  timezone: string | null;
  frequency: string | null;
  interval_days: number | null;
  is_active: boolean;
  is_deleted: boolean;
}

const QUIET_MS = 20 * 60 * 1000;   // no new calls for 20 min → run finished
const GRACE_MS = 10 * 60 * 1000;   // never evaluate "finished" in first 10 min
const MAX_RUN_MS = 3 * 60 * 60 * 1000; // hard cap: close run after 3 h

// ── London time helpers ──────────────────────────────────────────────────────

/** Offset (minutes) of Europe/London vs UTC at the given instant (0 or 60). */
export function getLondonOffsetMinutes(at: Date): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** London wall-clock parts for an instant. */
export function londonParts(at: Date): { dateKey: string; minutesOfDay: number } {
  const off = getLondonOffsetMinutes(at);
  const shifted = new Date(at.getTime() + off * 60_000);
  return {
    dateKey: shifted.toISOString().slice(0, 10),
    minutesOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** UTC instant of today's London hh:mm (today = London calendar day of `now`). */
export function londonScheduledUtc(now: Date, hour: number, minute: number): Date {
  const off = getLondonOffsetMinutes(now);
  const shifted = new Date(now.getTime() + off * 60_000);
  const utcMs = Date.UTC(
    shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(),
    hour, minute,
  ) - off * 60_000;
  return new Date(utcMs);
}

// ── Snapshot + attribution ───────────────────────────────────────────────────

export async function loadWbahCampaignSnapshot(sb: Sb): Promise<WbahCampaignSnapshotRow[]> {
  const { data, error } = await sb
    .from("wbah_campaign_snapshot")
    .select("*")
    .eq("workspace_id", WBAH_WORKSPACE_ID)
    .eq("is_deleted", false);
  if (error) {
    console.warn("[wbah-campaign-reporting] snapshot read failed:", error.message);
    return [];
  }
  return (data ?? []) as WbahCampaignSnapshotRow[];
}

/**
 * Attribute a call to a campaign: same agent_id, nearest scheduled call time
 * (London wall clock). Returns null when no campaign uses that agent.
 */
export function attributeWbahCampaign(
  campaigns: WbahCampaignSnapshotRow[],
  agentId: string | null | undefined,
  startedAtIso: string | null | undefined,
): WbahCampaignSnapshotRow | null {
  if (!agentId) return null;
  const candidates = campaigns.filter((c) => c.agent_id === agentId);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  if (!startedAtIso) return candidates[0];
  const started = new Date(startedAtIso);
  if (Number.isNaN(started.getTime())) return candidates[0];
  const { minutesOfDay } = londonParts(started);
  let best: WbahCampaignSnapshotRow = candidates[0];
  let bestDelta = Infinity;
  for (const c of candidates) {
    const sched = (c.call_hour ?? 0) * 60 + (c.call_minute ?? 0);
    // Calls happen AT or AFTER the scheduled slot; prefer the latest slot that
    // is <= the call time, falling back to plain nearest-distance.
    const delta = minutesOfDay >= sched ? minutesOfDay - sched : (sched - minutesOfDay) + 720;
    if (delta < bestDelta) { bestDelta = delta; best = c; }
  }
  return best;
}

// ── Per-run KPI computation ──────────────────────────────────────────────────

function isVoicemailCall(c: any): boolean {
  const r = String(c.disconnection_reason ?? c.end_reason ?? "").toLowerCase();
  return r.includes("voicemail");
}

function isConnectedCall(c: any): boolean {
  if (isVoicemailCall(c)) return false;
  const st = String(c.call_status ?? "").toLowerCase();
  return st === "completed" || st === "answered" || st === "connected";
}

export function computeWbahRunKpis(calls: any[]): Record<string, unknown> {
  let connected = 0, voicemail = 0, positive = 0, neutral = 0, negative = 0, booked = 0;
  const positiveLeads: Array<{ name: string; phone: string | null; booked: boolean }> = [];
  for (const c of calls) {
    if (isVoicemailCall(c)) voicemail++;
    if (isConnectedCall(c)) connected++;
    const s = String(c.sentiment ?? "").toLowerCase();
    if (s === "positive") positive++;
    else if (s === "negative") negative++;
    else if (s === "neutral") neutral++;
    const isBooked = Boolean(c.booking_status || c.appointment_date);
    if (isBooked) booked++;
    if (s === "positive" && positiveLeads.length < 25) {
      positiveLeads.push({
        name: c.customer_name ?? "Unknown",
        phone: c.phone ?? null,
        booked: isBooked,
      });
    }
  }
  const total = calls.length;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
  return {
    calls_dialled: total,
    calls_connected: connected,
    connection_rate_pct: pct(connected),
    voicemail_hits: voicemail,
    voicemail_rate_pct: pct(voicemail),
    booked,
    sentiment_positive: positive,
    sentiment_neutral: neutral,
    sentiment_negative: negative,
    positive_leads: positiveLeads,
  };
}

// ── Start / finish tick ──────────────────────────────────────────────────────

export interface WbahCampaignRunTickResult {
  started: number;
  finished: number;
  watching: number;
  errors: number;
}

interface EmailPrefs {
  recipients: string[];
  actingUserId: string | null;
  /** true when a preference row for this exact kind exists but is disabled. */
  muted: boolean;
}

/**
 * Per-kind email preferences for auto campaign reports, configurable from the
 * Reports tab "Dialler Report Setup" card:
 * - A schedule row for the exact kind (wbah_campaign_start / wbah_campaign_end)
 *   wins: disabled row = report still recorded in-app but NOT emailed; enabled
 *   row = email its recipients_json.
 * - No row for the kind → fall back to the enabled wbah_dialler_summary
 *   schedule's recipients (original behavior).
 *
 * Row selection is NEWEST-first (created_at desc) to match the Reports tab UI,
 * which lists schedules newest-first and edits the first match — so if
 * duplicate rows ever exist for a type, the row the client sees/edits is the
 * row that governs emails.
 */
async function getReportRecipients(
  sb: Sb,
  kind: "wbah_campaign_start" | "wbah_campaign_end",
): Promise<EmailPrefs> {
  try {
    const { data: own } = await sb
      .from("analytics_report_schedules")
      .select("recipients_json, created_by_user_id, enabled")
      .eq("workspace_id", WBAH_WORKSPACE_ID)
      .eq("report_type", kind)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (own) {
      if (!own.enabled) return { recipients: [], actingUserId: null, muted: true };
      const recipients = Array.isArray(own.recipients_json)
        ? own.recipients_json.map((r: any) => String(r)).filter(Boolean)
        : [];
      return { recipients, actingUserId: own.created_by_user_id ?? null, muted: false };
    }
    const { data } = await sb
      .from("analytics_report_schedules")
      .select("recipients_json, created_by_user_id")
      .eq("workspace_id", WBAH_WORKSPACE_ID)
      .eq("report_type", "wbah_dialler_summary")
      .eq("enabled", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const recipients = Array.isArray(data?.recipients_json)
      ? data.recipients_json.map((r: any) => String(r)).filter(Boolean)
      : [];
    return { recipients, actingUserId: data?.created_by_user_id ?? null, muted: false };
  } catch {
    return { recipients: [], actingUserId: null, muted: false };
  }
}

/** Fetch calls attributed to one campaign inside a window (paged, capped). */
async function fetchRunCalls(
  sb: Sb,
  campaigns: WbahCampaignSnapshotRow[],
  campaign: WbahCampaignSnapshotRow,
  windowStartIso: string,
): Promise<any[]> {
  const PAGE = 1000;
  const rows: any[] = [];
  for (let p = 0; p < 5; p++) {
    const { data, error } = await sb
      .from("wbah_calls")
      .select("id, customer_name, phone, sentiment, call_status, disconnection_reason, end_reason, booking_status, appointment_date, duration_seconds, started_at, meta")
      .eq("workspace_id", WBAH_WORKSPACE_ID)
      .gte("started_at", windowStartIso)
      .order("started_at", { ascending: false })
      .range(p * PAGE, p * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as any[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows.filter((c) => {
    const agentId = (c.meta as any)?.agent_id ?? null;
    return attributeWbahCampaign(campaigns, agentId, c.started_at)?.id === campaign.id;
  });
}

/**
 * The WBAH campaign start/finish tick. Called from the campaign-executor tick
 * chain (dev Vite plugin + prod pg_cron endpoint). NEVER throws.
 */
export async function runWbahCampaignRunTick(): Promise<WbahCampaignRunTickResult> {
  const result: WbahCampaignRunTickResult = { started: 0, finished: 0, watching: 0, errors: 0 };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as Sb;

    const campaigns = (await loadWbahCampaignSnapshot(sb)).filter((c) => c.is_active);
    if (campaigns.length === 0) return result;

    const now = new Date();
    const { dateKey } = londonParts(now);

    const { data: todayRuns } = await sb
      .from("wbah_campaign_runs")
      .select("*")
      .eq("workspace_id", WBAH_WORKSPACE_ID)
      .eq("run_date", dateKey);
    const runsByCampaign = new Map<string, any>(
      ((todayRuns ?? []) as any[]).map((r) => [String(r.campaign_id), r]),
    );

    const { generateAnalyticsReport } = await import("@/lib/analytics-hub/report-generator.server");
    const { sendAnalyticsReportEmail } = await import("@/lib/analytics-hub/report-email.server");
    const prefsCache = new Map<string, Promise<EmailPrefs>>();
    const getRecipients = (kind: "wbah_campaign_start" | "wbah_campaign_end") => {
      let p = prefsCache.get(kind);
      if (!p) { p = getReportRecipients(sb, kind); prefsCache.set(kind, p); }
      return p;
    };

    // ── 1. Start detection: window opened, no run row yet ────────────────────
    for (const c of campaigns) {
      if (c.call_hour == null) continue;
      const scheduled = londonScheduledUtc(now, c.call_hour, c.call_minute ?? 0);
      if (now.getTime() < scheduled.getTime()) continue;
      // Don't create "started" reports retroactively long after the window —
      // e.g. first deploy mid-afternoon shouldn't announce the 9 AM run.
      if (now.getTime() - scheduled.getTime() > MAX_RUN_MS) continue;
      if (runsByCampaign.has(c.id)) continue;

      try {
        // Insert claim first (unique campaign_id+run_date makes this atomic —
        // a concurrent tick loses the insert and skips).
        const { data: run, error: insErr } = await sb
          .from("wbah_campaign_runs")
          .insert({
            workspace_id: WBAH_WORKSPACE_ID,
            campaign_id: c.id,
            campaign_name: c.name,
            agent_id: c.agent_id,
            run_date: dateKey,
            window_start: scheduled.toISOString(),
            status: "running",
          })
          .select("*")
          .maybeSingle();
        if (insErr) {
          if (!String(insErr.message).toLowerCase().includes("duplicate")) {
            result.errors++;
            console.warn("[wbah-campaign-run] run insert failed:", insErr.message);
          }
          continue;
        }
        if (!run) continue;
        runsByCampaign.set(c.id, run);

        const hh = String(c.call_hour).padStart(2, "0");
        const mm = String(c.call_minute ?? 0).padStart(2, "0");
        const reportId = await generateAnalyticsReport({
          workspaceId: WBAH_WORKSPACE_ID,
          reportType: "wbah_campaign_start",
          name: `Campaign Started — ${c.name}`,
          dateFilter: "custom",
          dateRangeStart: scheduled.toISOString(),
          dateRangeEnd: now.toISOString(),
          generatedBy: "system",
          extraMetrics: {
            campaign_id: c.id,
            campaign_name: c.name,
            campaign_agent_id: c.agent_id,
            target_lead_status: c.lead_status,
            scheduled_time_london: `${hh}:${mm}`,
            frequency: c.frequency,
            run_date: dateKey,
          },
        });
        if (reportId) {
          await sb
            .from("wbah_campaign_runs")
            .update({ start_report_id: reportId, updated_at: new Date().toISOString() })
            .eq("id", run.id);
          const { recipients, actingUserId } = await getRecipients("wbah_campaign_start");
          if (recipients.length > 0) {
            await sendAnalyticsReportEmail(reportId, recipients, { actingUserId });
          }
        }
        result.started++;
      } catch (err: any) {
        result.errors++;
        console.warn("[wbah-campaign-run] start handling failed:", err?.message ?? err);
      }
    }

    // ── 2. Finish detection for running runs ─────────────────────────────────
    const running = [...runsByCampaign.values()].filter((r) => r.status === "running");
    // Also close out stale runs from previous days (server downtime etc.).
    const { data: staleRuns } = await sb
      .from("wbah_campaign_runs")
      .select("*")
      .eq("workspace_id", WBAH_WORKSPACE_ID)
      .eq("status", "running")
      .neq("run_date", dateKey)
      .limit(20);
    for (const r of (staleRuns ?? []) as any[]) running.push(r);
    if (running.length === 0) return result;

    // Refresh wbah_calls from WBAH's own Retell key (incremental; internally
    // throttled + in-flight-guarded; no WeeBespoke session involved).
    try {
      const { refreshWbahCallsFromRetell } = await import(
        "@/lib/integrations/webespokeEnterprise/wbah-retell-calls-sync"
      );
      await refreshWbahCallsFromRetell();
    } catch (err: any) {
      console.warn("[wbah-campaign-run] retell refresh failed (continuing):", err?.message ?? err);
    }

    for (const run of running) {
      try {
        const campaign = campaigns.find((c) => c.id === run.campaign_id);
        const windowStart = new Date(run.window_start);
        const age = now.getTime() - windowStart.getTime();
        if (age < GRACE_MS) { result.watching++; continue; }

        const calls = campaign
          ? await fetchRunCalls(sb, campaigns, campaign, run.window_start)
          : [];
        const newestMs = calls.reduce((max, c) => {
          const t = new Date(c.started_at ?? 0).getTime();
          return Number.isFinite(t) && t > max ? t : max;
        }, 0);

        const quiet = calls.length > 0 && now.getTime() - newestMs >= QUIET_MS;
        const capped = age >= MAX_RUN_MS;
        if (!quiet && !capped) { result.watching++; continue; }

        const kpis = computeWbahRunKpis(calls);
        const windowEnd = new Date(newestMs > 0 ? newestMs : now.getTime());

        // Claim the finish (compare-and-set on status) so concurrent ticks
        // can't double-send.
        const { data: claimed } = await sb
          .from("wbah_campaign_runs")
          .update({
            status: "finished",
            window_end: windowEnd.toISOString(),
            kpis,
            updated_at: new Date().toISOString(),
          })
          .eq("id", run.id)
          .eq("status", "running")
          .select("id");
        if (!claimed?.length) continue;

        const reportId = await generateAnalyticsReport({
          workspaceId: WBAH_WORKSPACE_ID,
          reportType: "wbah_campaign_end",
          name: `Campaign Finished — ${run.campaign_name ?? "Dialler campaign"}`,
          dateFilter: "custom",
          dateRangeStart: run.window_start,
          dateRangeEnd: windowEnd.toISOString(),
          generatedBy: "system",
          extraMetrics: {
            campaign_id: run.campaign_id,
            campaign_name: run.campaign_name,
            campaign_agent_id: run.agent_id,
            target_lead_status: campaign?.lead_status ?? null,
            run_date: run.run_date,
            run_ended_by: capped && !quiet ? "time_cap" : "dialling_quiet",
            ...kpis,
          },
        });
        if (reportId) {
          await sb
            .from("wbah_campaign_runs")
            .update({ end_report_id: reportId, updated_at: new Date().toISOString() })
            .eq("id", run.id);
          const { recipients, actingUserId } = await getRecipients("wbah_campaign_end");
          if (recipients.length > 0) {
            await sendAnalyticsReportEmail(reportId, recipients, { actingUserId });
          }
        }
        result.finished++;
      } catch (err: any) {
        result.errors++;
        console.warn("[wbah-campaign-run] finish handling failed:", err?.message ?? err);
      }
    }
  } catch (err: any) {
    result.errors++;
    console.warn("[wbah-campaign-run] tick failed (non-fatal):", err?.message ?? err);
  }
  return result;
}

// ── Opportunistic snapshot refresh (called from live campaign reads) ─────────

/**
 * Upsert the campaign snapshot from a fresh live WeeBespoke campaign list.
 * Best-effort — never throws. Accepts normalized OR raw campaign objects.
 */
export async function upsertWbahCampaignSnapshot(rawCampaigns: any[]): Promise<void> {
  try {
    if (!Array.isArray(rawCampaigns) || rawCampaigns.length === 0) return;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as Sb;
    const nowIso = new Date().toISOString();
    const rows = rawCampaigns
      .filter((c) => c && typeof c === "object" && c.id)
      .map((c) => ({
        id: String(c.id),
        workspace_id: WBAH_WORKSPACE_ID,
        name: c.name ?? c.campaign_name ?? "Unnamed campaign",
        status: typeof c.status === "string" ? c.status : null,
        agent_id: c.agent_id ?? null,
        lead_status: c.lead_status ?? null,
        call_hour: c.call_hour ?? null,
        call_minute: c.call_minute ?? null,
        timezone: c.timezone ?? "Europe/London",
        frequency: c.frequency ?? c.frequency_type ?? null,
        interval_days: c.interval_days ?? null,
        is_active: c.isActive !== false,
        is_deleted: c.isDeleted === true,
        raw: c,
        synced_at: nowIso,
      }));
    if (rows.length === 0) return;
    const { error } = await sb
      .from("wbah_campaign_snapshot")
      .upsert(rows, { onConflict: "id" });
    if (error) {
      console.warn("[wbah-campaign-reporting] snapshot upsert failed:", error.message);
      return;
    }
    // Campaigns deleted upstream disappear from the live list — mark them.
    const liveIds = rows.map((r) => r.id);
    await sb
      .from("wbah_campaign_snapshot")
      .update({ is_deleted: true, synced_at: nowIso })
      .eq("workspace_id", WBAH_WORKSPACE_ID)
      .not("id", "in", `(${liveIds.map((id) => `"${id}"`).join(",")})`);
  } catch (err: any) {
    console.warn("[wbah-campaign-reporting] snapshot upsert error:", err?.message ?? err);
  }
}
