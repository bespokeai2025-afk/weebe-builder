/**
 * WBAH HiveMind call metrics — pure, client-safe helpers.
 *
 * WBAH's real call activity lives in `wbah_calls` (the standard `calls` table
 * holds only a handful of legacy rows), and WBAH is a UK business, so "today"
 * means the Europe/London calendar day (BST/GMT aware), NOT server-local
 * midnight. These helpers are pure so both the server fetcher and the
 * regression tests share the exact same definitions.
 */

export const WBAH_CALLS_TIMEZONE = "Europe/London";

/** Which table sources HiveMind call metrics for a workspace. */
export function hivemindCallsSourceTable(isWbah: boolean): "wbah_calls" | "calls" {
  return isWbah ? "wbah_calls" : "calls";
}

function londonOffsetMinutes(at: Date): number {
  const part = new Intl.DateTimeFormat("en-GB", {
    timeZone: WBAH_CALLS_TIMEZONE,
    timeZoneName: "longOffset",
  })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = part.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0; // plain "GMT" (winter) → +00:00
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** UTC instant of London-local midnight for the given London-local Y/M/D. */
function londonMidnightUtc(y: number, mo: number, d: number): Date {
  // Guess UTC midnight, then correct by the London offset at that instant.
  // Iterate twice so DST transitions land on the right side.
  let t = Date.UTC(y, mo - 1, d);
  for (let i = 0; i < 2; i++) {
    t = Date.UTC(y, mo - 1, d) - londonOffsetMinutes(new Date(t)) * 60_000;
  }
  return new Date(t);
}

function londonYmd(at: Date): { y: number; mo: number; d: number } {
  const [y, mo, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: WBAH_CALLS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(at)
    .split("-")
    .map(Number);
  return { y, mo, d };
}

/** [start, end) UTC window covering the London-local day containing `now`. */
export function londonDayWindowUtc(now: Date = new Date()): { startUtc: Date; endUtc: Date } {
  const { y, mo, d } = londonYmd(now);
  const startUtc = new Date(londonMidnightUtc(y, mo, d));
  const nextDay = new Date(Date.UTC(y, mo - 1, d) + 86_400_000);
  const endUtc = londonMidnightUtc(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate());
  return { startUtc, endUtc };
}

/** UTC instant of the first London-local midnight of the London month containing `now`. */
export function londonMonthStartUtc(now: Date = new Date()): Date {
  const { y, mo } = londonYmd(now);
  return londonMidnightUtc(y, mo, 1);
}

export interface WbahCallRowLike {
  id: string;
  retell_call_id?: string | null;
  sentiment?: string | null;
  end_reason?: string | null;
  started_at?: string | null;
  synced_at?: string | null;
}

export interface WbahCallMetrics {
  /** "ok" = successful fresh query (zero rows is a REAL zero). */
  status: "ok" | "error";
  timezone: string;
  windowStartUtc: string;
  windowEndUtc: string;
  totalToday: number;
  monthTotal: number;
  voicemailToday: number;
  connectedToday: number;
  failedToday: number;
  positiveToday: number;
  neutralToday: number;
  negativeToday: number;
  /** Existing approved WBAH definition: qualified = positive sentiment. */
  qualifiedToday: number;
  newestSyncAt: string | null;
  /** True when the newest sync is older than the staleness threshold. */
  stale: boolean;
  warning: string | null;
}

export const WBAH_CALLS_UNAVAILABLE_WARNING =
  "Current WBAH call activity is unavailable or delayed.";

/** Newest sync older than this ⇒ data flagged stale (dialer runs continuously in business hours). */
export const WBAH_CALLS_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

const FAILED_END_REASONS = new Set([
  "dial_failed",
  "dial_busy",
  "dial_no_answer",
  "error",
  "registered_call_timeout",
  "call_transfer_failed",
  "error_llm_websocket_open",
  "error_inbound_webhook",
]);

/**
 * Compute the WBAH call metrics from raw `wbah_calls` rows for the London day.
 * Total calls include ALL outcomes (voicemails, failures, every sentiment);
 * sentiment/qualified figures are subsets. Rows are deduplicated by the
 * authoritative provider call id (`retell_call_id`) where present, falling
 * back to the row id (see wbah-calls weak-id duplicate history).
 */
export function computeWbahCallMetrics(args: {
  rowsToday: WbahCallRowLike[];
  monthTotal: number;
  newestSyncAt: string | null;
  windowStartUtc: Date;
  windowEndUtc: Date;
  now?: Date;
}): WbahCallMetrics {
  const now = args.now ?? new Date();
  const seen = new Set<string>();
  const rows: WbahCallRowLike[] = [];
  for (const r of args.rowsToday) {
    const key = (r.retell_call_id && String(r.retell_call_id).trim()) || `row:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(r);
  }

  const sent = (r: WbahCallRowLike) => String(r.sentiment ?? "").trim().toLowerCase();
  const voicemailToday = rows.filter((r) => r.end_reason === "voicemail_reached").length;
  const failedToday = rows.filter((r) => FAILED_END_REASONS.has(String(r.end_reason ?? ""))).length;
  const positiveToday = rows.filter((r) => sent(r) === "positive").length;
  const neutralToday = rows.filter((r) => sent(r) === "neutral").length;
  const negativeToday = rows.filter((r) => sent(r) === "negative").length;

  const newestSyncAt = args.newestSyncAt;
  const stale =
    !!newestSyncAt && now.getTime() - new Date(newestSyncAt).getTime() > WBAH_CALLS_STALE_AFTER_MS;

  return {
    status: "ok",
    timezone: WBAH_CALLS_TIMEZONE,
    windowStartUtc: args.windowStartUtc.toISOString(),
    windowEndUtc: args.windowEndUtc.toISOString(),
    totalToday: rows.length,
    monthTotal: args.monthTotal,
    voicemailToday,
    connectedToday: rows.length - voicemailToday,
    failedToday,
    positiveToday,
    neutralToday,
    negativeToday,
    qualifiedToday: positiveToday,
    newestSyncAt,
    stale,
    warning: stale ? WBAH_CALLS_UNAVAILABLE_WARNING : null,
  };
}

/** Error result — HiveMind must surface the warning, never a silent zero. */
export function wbahCallMetricsError(window: { startUtc: Date; endUtc: Date }): WbahCallMetrics {
  return {
    status: "error",
    timezone: WBAH_CALLS_TIMEZONE,
    windowStartUtc: window.startUtc.toISOString(),
    windowEndUtc: window.endUtc.toISOString(),
    totalToday: 0,
    monthTotal: 0,
    voicemailToday: 0,
    connectedToday: 0,
    failedToday: 0,
    positiveToday: 0,
    neutralToday: 0,
    negativeToday: 0,
    qualifiedToday: 0,
    newestSyncAt: null,
    stale: true,
    warning: WBAH_CALLS_UNAVAILABLE_WARNING,
  };
}

/**
 * Render the CALLS context lines HiveMind reads. On query failure the block
 * contains ONLY the explicit warning (never a fabricated "0 calls").
 */
export function buildWbahCallsContextLines(m: WbahCallMetrics): string[] {
  if (m.status !== "ok") {
    return [`\nCALLS (WBAH): ⚠ ${WBAH_CALLS_UNAVAILABLE_WARNING} Do NOT report a call count.`];
  }
  const lines = [
    `\nCALLS (WBAH — sourced live from wbah_calls, Europe/London day):`,
    `  Today: ${m.totalToday} total calls (ALL outcomes) | ${m.voicemailToday} voicemail | ${m.connectedToday} connected (non-voicemail) | ${m.failedToday} failed`,
    `  Sentiment today: ${m.positiveToday} positive | ${m.neutralToday} neutral | ${m.negativeToday} negative`,
    `  Qualified today (positive sentiment): ${m.qualifiedToday} — a subset of the ${m.totalToday} total calls`,
    `  This month: ${m.monthTotal} calls`,
    `  Newest call sync: ${m.newestSyncAt ?? "unknown"}${m.stale ? " — ⚠ data may be delayed" : " (fresh)"}`,
  ];
  if (m.warning) lines.push(`  ⚠ ${m.warning}`);
  return lines;
}
