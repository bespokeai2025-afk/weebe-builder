/**
 * Microsoft Clarity sync core + Website Change Queue engine.
 *
 * ALIAS-FREE (no "@/" imports): this module is imported from the
 * campaign-scheduler Vite plugin chain at config time. Keep every import
 * relative or package-level.
 *
 * Clarity Data Export API — honest capability limits (per Microsoft docs):
 *  - GET https://www.clarity.ms/export-data/api/v1/project-live-insights
 *  - Bearer token (project admin generates it in Clarity → Settings → Data Export)
 *  - numOfDays 1..3 only (rolling last 24/48/72h — no historical backfill)
 *  - Max 10 API requests per project per DAY (429 when exceeded)
 *  - Max 3 dimensions per request; responses capped at 1,000 rows, no pagination
 *  - Aggregate counts only (dead/rage clicks, excessive scroll, quick-backs,
 *    script errors, engagement) — no session recordings or heatmaps via API.
 *
 * Sync design under those limits: ONE request per workspace per day
 * (numOfDays=1, URL × Device breakdown), upserted into clarity_metrics_daily.
 * History accumulates day by day on our side because Clarity cannot backfill.
 *
 * Website Change Queue rules (mirrors the SEO Opportunity Queue):
 *  - Never invents metrics — every recommendation carries the raw Clarity +
 *    conversion evidence that produced it, and a signal must appear on at
 *    least MIN_SIGNAL_DAYS distinct days (no single-day noise).
 *  - Deterministic thresholds; no AI calls.
 *  - Tables are server-write-only; all writes via service role.
 *  - Dedupe: one live row per (workspace, change_type:page). Open rows are
 *    refreshed in place; executing/handled/recently-dismissed rows are never
 *    re-proposed; stale open rows expire.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

export const CLARITY_API_BASE = "https://www.clarity.ms/export-data/api/v1";

export const CLARITY_LIMITS = {
  maxRequestsPerProjectPerDay: 10,
  maxNumOfDays: 3,
  maxDimensions: 3,
  maxRowsPerResponse: 1000,
  note: "Clarity's Data Export API returns aggregate counts for the last 1-3 days only (no historical backfill, no recordings). WEBEE syncs once per day and accumulates history locally.",
} as const;

// ── Clarity API client ────────────────────────────────────────────────────────

export interface ClarityFetchResult {
  ok: boolean;
  status: number;
  payload?: unknown;
  error?: string;
  rateLimited?: boolean;
}

export async function fetchClarityInsights(
  apiToken: string,
  opts: { numOfDays?: 1 | 2 | 3; dimensions?: string[] } = {},
): Promise<ClarityFetchResult> {
  const numOfDays = opts.numOfDays ?? 1;
  const dims = (opts.dimensions ?? []).slice(0, CLARITY_LIMITS.maxDimensions);
  const params = new URLSearchParams({ numOfDays: String(numOfDays) });
  dims.forEach((d, i) => params.set(`dimension${i + 1}`, d));
  let res: Response;
  try {
    res = await fetch(`${CLARITY_API_BASE}/project-live-insights?${params.toString()}`, {
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e: any) {
    return { ok: false, status: 0, error: `Clarity API unreachable: ${String(e?.message ?? e)}` };
  }
  if (res.status === 429) {
    return { ok: false, status: 429, rateLimited: true, error: "Clarity daily request limit reached (max 10 API requests per project per day). Sync will retry tomorrow." };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, error: `Clarity token rejected (${res.status}) — regenerate the API token in Clarity → Settings → Data Export.` };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: `Clarity API error ${res.status}: ${text.slice(0, 300)}` };
  }
  try {
    return { ok: true, status: res.status, payload: await res.json() };
  } catch {
    return { ok: false, status: res.status, error: "Clarity API returned non-JSON payload" };
  }
}

// ── Response parsing (pure, tested) ──────────────────────────────────────────

export type ClarityPageMetrics = {
  url: string;
  device: string;
  sessions: number;
  distinctUsers: number;
  botSessions: number;
  metrics: Record<string, number>; // deadClicks, rageClicks, excessiveScroll, quickbackClicks, scriptErrors, errorClicks, engagementTimeSec, scrollDepthPct
};

const METRIC_KEY_MAP: Record<string, string> = {
  DeadClickCount: "deadClicks",
  RageClickCount: "rageClicks",
  ExcessiveScroll: "excessiveScroll",
  QuickbackClick: "quickbackClicks",
  ScriptErrorCount: "scriptErrors",
  ErrorClickCount: "errorClicks",
  ScrollDepth: "scrollDepthPct",
  EngagementTime: "engagementTimeSec",
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Clarity returns an array of { metricName, information: [rows] } where each
 * row carries the requested dimension fields (URL, Device, ...) plus metric
 * values whose field names vary per metric. Parse defensively into per-page
 * rows; unknown metrics are ignored rather than guessed.
 */
export function parseClarityPayload(payload: unknown): ClarityPageMetrics[] {
  if (!Array.isArray(payload)) return [];
  const byKey = new Map<string, ClarityPageMetrics>();
  const rowFor = (url: string, device: string): ClarityPageMetrics => {
    const key = `${url}\u0000${device}`;
    let row = byKey.get(key);
    if (!row) {
      row = { url, device, sessions: 0, distinctUsers: 0, botSessions: 0, metrics: {} };
      byKey.set(key, row);
    }
    return row;
  };
  for (const metric of payload as any[]) {
    const name = String(metric?.metricName ?? "");
    const info: any[] = Array.isArray(metric?.information) ? metric.information : [];
    for (const r of info) {
      const url = String(r?.URL ?? r?.Url ?? r?.url ?? "").trim();
      if (!url) continue;
      const device = String(r?.Device ?? r?.device ?? "").trim();
      const row = rowFor(url, device);
      if (name === "Traffic") {
        row.sessions = Math.max(row.sessions, num(r.totalSessionCount));
        row.distinctUsers = Math.max(row.distinctUsers, num(r.distantUserCount ?? r.distinctUserCount));
        row.botSessions = Math.max(row.botSessions, num(r.totalBotSessionCount));
        continue;
      }
      const mapped = METRIC_KEY_MAP[name];
      if (!mapped) continue; // unknown metric — never guess
      if (name === "ScrollDepth") {
        row.metrics[mapped] = num(r.averageScrollDepth ?? r.subTotal);
      } else if (name === "EngagementTime") {
        row.metrics[mapped] = num(r.activeTime ?? r.totalTime ?? r.subTotal);
      } else {
        // Count metrics report per-row session counts under varying names.
        row.metrics[mapped] = num(r.subTotal ?? r.sessionsCount ?? r.sessionsWithMetricPercentage ?? r.pagesViews);
      }
    }
  }
  return [...byKey.values()];
}

// ── Credentials ───────────────────────────────────────────────────────────────

export async function getClarityCredentials(
  workspaceId: string,
  sbOverride?: SupabaseClient,
): Promise<{ apiToken: string; projectId: string | null } | null> {
  const admin = (sbOverride ?? adminClient()) as any;
  const { data } = await admin
    .from("provider_settings")
    .select("credentials, status")
    .eq("workspace_id", workspaceId)
    .eq("provider_category", "analytics")
    .eq("provider_name", "microsoft_clarity")
    .maybeSingle();
  const creds = (data?.credentials ?? {}) as Record<string, string>;
  const apiToken = String(creds.apiToken ?? "").trim();
  if (!apiToken || data?.status === "disconnected") return null;
  return { apiToken, projectId: String(creds.projectId ?? "").trim() || null };
}

// ── Daily sync ────────────────────────────────────────────────────────────────

export interface ClaritySyncResult {
  ok: boolean;
  rows: number;
  error?: string;
  rateLimited?: boolean;
  /** True when OUR local daily-attempt lease blocked the request (quota protection, not an API error). */
  quotaGated?: boolean;
}

// Local quota lease: Clarity allows 10 requests/project/DAY. We reserve a
// safety margin (max 8 attempts/day) and space attempts ≥30 min apart so
// repeated manual clicks, health sweeps and failing ticks can never burn the
// quota. State lives under a reserved key in provider_settings.credentials
// (same pattern as the campaign executor's __sched_v1__ blob).
const QUOTA_KEY = "__clarity_quota_v1__";
const MAX_ATTEMPTS_PER_DAY = 8;
const MIN_ATTEMPT_SPACING_MS = 30 * 60_000;

/**
 * Atomically-ish reserve one Clarity API attempt for today. Returns null when
 * allowed (and records the attempt), or a human-readable reason when gated.
 */
async function reserveClarityAttempt(admin: any, workspaceId: string): Promise<string | null> {
  const { data } = await admin.from("provider_settings")
    .select("id, credentials")
    .eq("workspace_id", workspaceId)
    .eq("provider_category", "analytics")
    .eq("provider_name", "microsoft_clarity")
    .maybeSingle();
  if (!data) return "Microsoft Clarity is not connected for this workspace";
  const creds = { ...((data.credentials ?? {}) as Record<string, unknown>) };
  const today = new Date().toISOString().slice(0, 10);
  const q = (creds[QUOTA_KEY] ?? {}) as { date?: string; attempts?: number; lastAttemptAt?: string };
  const attempts = q.date === today ? Number(q.attempts ?? 0) : 0;
  if (attempts >= MAX_ATTEMPTS_PER_DAY) {
    return `Daily Clarity API attempt budget used (${MAX_ATTEMPTS_PER_DAY}/day local safety cap; Clarity allows 10) — try again tomorrow`;
  }
  if (q.lastAttemptAt && Date.now() - new Date(q.lastAttemptAt).getTime() < MIN_ATTEMPT_SPACING_MS) {
    return "A Clarity sync was attempted less than 30 minutes ago — waiting to protect the 10-requests/day API quota";
  }
  creds[QUOTA_KEY] = { date: today, attempts: attempts + 1, lastAttemptAt: new Date().toISOString() };
  const { error } = await admin.from("provider_settings")
    .update({ credentials: creds, updated_at: new Date().toISOString() })
    .eq("id", data.id);
  if (error) return `Could not record Clarity quota attempt (failing closed): ${error.message}`;
  return null;
}

export async function runClaritySyncForWorkspace(
  workspaceId: string,
  sbOverride?: SupabaseClient,
): Promise<ClaritySyncResult> {
  const admin = (sbOverride ?? adminClient()) as any;
  const creds = await getClarityCredentials(workspaceId, admin);
  if (!creds) return { ok: false, rows: 0, error: "Microsoft Clarity is not connected for this workspace" };

  // Local daily-attempt lease — every caller (tick, health sweep, manual
  // "Sync now") goes through this single choke point.
  const gated = await reserveClarityAttempt(admin, workspaceId);
  if (gated) return { ok: false, rows: 0, error: gated, quotaGated: true };

  // ONE request per sync: last 24h, URL × Device (2 of the 3 dimension slots).
  const res = await fetchClarityInsights(creds.apiToken, { numOfDays: 1, dimensions: ["URL", "Device"] });
  const nowIso = new Date().toISOString();
  if (!res.ok) {
    await admin.from("provider_settings").update({
      status: res.status === 401 || res.status === 403 ? "error" : undefined,
      updated_at: nowIso,
    }).eq("workspace_id", workspaceId).eq("provider_category", "analytics").eq("provider_name", "microsoft_clarity");
    return { ok: false, rows: 0, error: res.error, rateLimited: res.rateLimited };
  }

  const pages = parseClarityPayload(res.payload);
  const metricDate = new Date().toISOString().slice(0, 10); // last-24h window attributed to today
  let written = 0;
  for (let i = 0; i < pages.length; i += 100) {
    const batch = pages.slice(i, i + 100).map((p) => ({
      workspace_id: workspaceId,
      metric_date: metricDate,
      url: p.url.slice(0, 2000),
      device: p.device,
      sessions: p.sessions,
      distinct_users: p.distinctUsers,
      bot_sessions: p.botSessions,
      metrics: p.metrics,
      updated_at: nowIso,
    }));
    const { error } = await admin.from("clarity_metrics_daily")
      .upsert(batch, { onConflict: "workspace_id,metric_date,url,device" });
    if (error) return { ok: false, rows: written, error: `clarity_metrics_daily upsert failed: ${error.message}` };
    written += batch.length;
  }
  await admin.from("provider_settings").update({
    status: "connected", last_sync: nowIso, updated_at: nowIso,
  }).eq("workspace_id", workspaceId).eq("provider_category", "analytics").eq("provider_name", "microsoft_clarity");
  return { ok: true, rows: written };
}

/** Daily tick: sync every workspace with Clarity credentials whose last sync is stale. */
export async function runClaritySyncTick(): Promise<{ ran: Array<{ workspaceId: string; rows: number }>; skipped: number; failed: Array<{ workspaceId: string; error: string }> }> {
  const admin = adminClient() as any;
  const ran: Array<{ workspaceId: string; rows: number }> = [];
  const failed: Array<{ workspaceId: string; error: string }> = [];
  let skipped = 0;
  // Enumerate workspace ids + non-secret state only — NEVER bulk-read every
  // tenant's credentials. Per-workspace credential loading happens inside
  // runClaritySyncForWorkspace via getClarityCredentials.
  const { data: rows } = await admin
    .from("provider_settings")
    .select("workspace_id, last_sync, status")
    .eq("provider_category", "analytics")
    .eq("provider_name", "microsoft_clarity");
  const staleBefore = Date.now() - 20 * 3600_000; // ~daily; 20h guards drift
  for (const row of rows ?? []) {
    if (row.status === "disconnected") { skipped++; continue; }
    if (row.last_sync && new Date(row.last_sync).getTime() > staleBefore) { skipped++; continue; }
    try {
      const r = await runClaritySyncForWorkspace(row.workspace_id, admin);
      if (r.ok) {
        ran.push({ workspaceId: row.workspace_id, rows: r.rows });
        try { await refreshWebsiteChangeQueue(row.workspace_id, admin); } catch { /* best-effort */ }
      } else if (!r.rateLimited && !r.quotaGated && !/not connected/i.test(r.error ?? "")) {
        failed.push({ workspaceId: row.workspace_id, error: r.error ?? "unknown" });
      } else {
        skipped++;
      }
    } catch (e: any) {
      failed.push({ workspaceId: row.workspace_id, error: String(e?.message ?? e) });
    }
  }
  return { ran, skipped, failed };
}

// ── UX signal detection ───────────────────────────────────────────────────────

export type ChangeType =
  | "headline" | "cta_copy" | "cta_position" | "section_order" | "social_proof"
  | "pricing_presentation" | "form_optimisation" | "ava_positioning" | "landing_content" | "faq";

export interface PageSignal {
  url: string;
  days: number;               // distinct days the signal appeared
  sessions: number;
  deadClicks: number;
  rageClicks: number;
  excessiveScroll: number;
  quickbackClicks: number;
  scriptErrors: number;
  errorClicks: number;
  mobileShareOfProblems: number; // 0..1 of dead+rage clicks occurring on Mobile
}

export interface ChangeCandidate {
  changeType: ChangeType;
  pageUrl: string;
  title: string;
  currentState: string;
  proposedState: string;
  why: string;
  supportingData: Record<string, unknown>;
  expectedImpact: string;
  risk: string;
  rollbackPlan: string;
  confidence: number; // 0..1
  score: number;
}

export const MIN_SIGNAL_DAYS = 2;      // never act on single-day noise
const MIN_SESSIONS = 30;               // ignore pages with negligible traffic
const DEAD_CLICK_RATE = 0.08;          // dead clicks per session
const RAGE_CLICK_RATE = 0.04;
const QUICKBACK_RATE = 0.15;
const EXCESSIVE_SCROLL_RATE = 0.12;
const MOBILE_PROBLEM_SHARE = 0.65;

/** Aggregate daily metric rows into per-page signals (pure, tested). */
export function aggregateClaritySignals(
  rows: Array<{ metric_date: string; url: string; device: string; sessions: number; metrics: Record<string, number> }>,
): PageSignal[] {
  const byUrl = new Map<string, PageSignal & { _days: Set<string>; _mobileProblems: number; _totalProblems: number }>();
  for (const r of rows) {
    let s = byUrl.get(r.url);
    if (!s) {
      s = { url: r.url, days: 0, sessions: 0, deadClicks: 0, rageClicks: 0, excessiveScroll: 0, quickbackClicks: 0, scriptErrors: 0, errorClicks: 0, mobileShareOfProblems: 0, _days: new Set(), _mobileProblems: 0, _totalProblems: 0 };
      byUrl.set(r.url, s);
    }
    const m = r.metrics ?? {};
    const problems = num(m.deadClicks) + num(m.rageClicks);
    s._days.add(r.metric_date);
    s.sessions += num(r.sessions);
    s.deadClicks += num(m.deadClicks);
    s.rageClicks += num(m.rageClicks);
    s.excessiveScroll += num(m.excessiveScroll);
    s.quickbackClicks += num(m.quickbackClicks);
    s.scriptErrors += num(m.scriptErrors);
    s.errorClicks += num(m.errorClicks);
    s._totalProblems += problems;
    if (/mobile/i.test(r.device)) s._mobileProblems += problems;
  }
  return [...byUrl.values()].map((s) => {
    s.days = s._days.size;
    s.mobileShareOfProblems = s._totalProblems > 0 ? s._mobileProblems / s._totalProblems : 0;
    const { _days, _mobileProblems, _totalProblems, ...rest } = s;
    return rest;
  });
}

export type ConversionByPage = { path: string; recent: number; prior: number };

function pathOf(url: string): string {
  try { return new URL(url).pathname.replace(/\/$/, "") || "/"; }
  catch { return url.startsWith("/") ? url.replace(/\/$/, "") || "/" : url; }
}

function classifyPage(path: string): "pricing" | "form" | "faq" | "landing" | "generic" {
  if (/pric|plan|cost/i.test(path)) return "pricing";
  if (/contact|signup|sign-up|register|book|demo|quote|form/i.test(path)) return "form";
  if (/faq|help|support/i.test(path)) return "faq";
  if (path === "/" || /^\/(home|index|landing)?$/i.test(path)) return "landing";
  return "generic";
}

/**
 * Deterministic UX change detection. Every candidate cites the Clarity counts
 * and (when available) the conversion trend for the same path — combined
 * behaviour + outcome evidence, exactly as stored.
 */
export function detectWebsiteChanges(
  signals: PageSignal[],
  conversions: ConversionByPage[],
): ChangeCandidate[] {
  const convByPath = new Map(conversions.map((c) => [c.path, c]));
  const out: ChangeCandidate[] = [];

  for (const s of signals) {
    if (s.days < MIN_SIGNAL_DAYS || s.sessions < MIN_SESSIONS) continue;
    const path = pathOf(s.url);
    const pageClass = classifyPage(path);
    const conv = convByPath.get(path) ?? null;
    const convDelta = conv && conv.prior > 0 ? (conv.recent - conv.prior) / conv.prior : null;
    const convNote = conv
      ? `Conversions from ${path}: ${conv.recent} recent vs ${conv.prior} prior${convDelta != null ? ` (${convDelta >= 0 ? "+" : ""}${Math.round(convDelta * 100)}%)` : ""}.`
      : `No conversion events recorded from ${path} — outcome evidence unavailable for this page.`;
    const evidence = {
      claritySignal: { days: s.days, sessions: s.sessions, deadClicks: s.deadClicks, rageClicks: s.rageClicks, excessiveScroll: s.excessiveScroll, quickbackClicks: s.quickbackClicks, scriptErrors: s.scriptErrors, errorClicks: s.errorClicks, mobileShareOfProblems: Math.round(s.mobileShareOfProblems * 100) / 100 },
      conversions: conv ?? null,
      windowNote: `Signals observed on ${s.days} distinct days (min ${MIN_SIGNAL_DAYS}); Clarity aggregates last-24h windows synced daily.`,
    };
    const convBoost = convDelta != null && convDelta < -0.1 ? 1.4 : 1;
    const convConfidence = conv ? 0.15 : 0;

    const deadRate = s.deadClicks / s.sessions;
    const rageRate = s.rageClicks / s.sessions;
    const quickbackRate = s.quickbackClicks / s.sessions;
    const scrollRate = s.excessiveScroll / s.sessions;

    // Dead/rage clicks → CTA or pricing element not responding as users expect.
    if (deadRate >= DEAD_CLICK_RATE || rageRate >= RAGE_CLICK_RATE) {
      const isPricing = pageClass === "pricing";
      const isForm = pageClass === "form";
      const changeType: ChangeType = isPricing ? "pricing_presentation" : isForm ? "form_optimisation" : "cta_copy";
      out.push({
        changeType,
        pageUrl: s.url,
        title: `${isPricing ? "Pricing elements" : isForm ? "Form elements" : "Elements"} on ${path} receive ${s.deadClicks} dead / ${s.rageClicks} rage clicks`,
        currentState: `Users click elements on ${path} that do not respond (${s.deadClicks} dead clicks, ${s.rageClicks} rage clicks across ${s.sessions} sessions over ${s.days} days). The exact elements are visible in Clarity's dashboard heatmaps (not exposed via API).`,
        proposedState: isPricing
          ? "Make pricing cards/toggles explicitly interactive or visibly static: clickable areas get clear affordances and a working action; decorative elements lose click-suggesting styling."
          : isForm
            ? "Ensure every form control and button responds on first interaction; remove click-suggesting styling from non-interactive labels."
            : "Turn the most-clicked non-interactive elements into working CTAs (or remove their button-like styling) so first clicks always respond.",
        why: `${(deadRate * 100).toFixed(1)}% of sessions produce dead clicks (threshold ${(DEAD_CLICK_RATE * 100).toFixed(0)}%). ${convNote}`,
        supportingData: evidence,
        expectedImpact: conv && convDelta != null && convDelta < 0
          ? "Recovering the frustrated-click journeys could reverse part of the measured conversion decline; magnitude cannot be promised in advance."
          : "Fewer abandoned journeys from unresponsive elements; effect must be measured after deployment, not assumed.",
        risk: "Low-to-medium: visual/behaviour change on a live page; wrong element identification wastes a deploy cycle — confirm the exact element in Clarity heatmaps before deploying.",
        rollbackPlan: "Capture the current section markup/screenshot before deploying; restore it to roll back. No data is destroyed.",
        confidence: Math.min(0.9, 0.5 + convConfidence + (s.days >= 4 ? 0.15 : 0) + (deadRate >= DEAD_CLICK_RATE * 2 ? 0.1 : 0)),
        score: 0,
      });
    }

    // Quick-backs → landing content mismatch with what users expected.
    if (quickbackRate >= QUICKBACK_RATE) {
      out.push({
        changeType: pageClass === "landing" ? "headline" : "landing_content",
        pageUrl: s.url,
        title: `${Math.round(quickbackRate * 100)}% of visits to ${path} bounce straight back`,
        currentState: `${s.quickbackClicks} quick-back visits out of ${s.sessions} sessions over ${s.days} days — users arrive, don't find what they expected, and immediately return.`,
        proposedState: "Rewrite the above-the-fold headline/intro so it states, in the visitor's words, what the page offers and for whom — matched to the traffic sources feeding this page.",
        why: `Quick-back rate ${(quickbackRate * 100).toFixed(1)}% exceeds the ${(QUICKBACK_RATE * 100).toFixed(0)}% threshold. ${convNote}`,
        supportingData: evidence,
        expectedImpact: "Lower quick-back rate and more visitors reaching the page's CTA; measure via Clarity after deployment.",
        risk: "Medium: headline changes affect brand voice and SEO titles — keep target keywords if the page ranks.",
        rollbackPlan: "Store the current headline/intro text in the change package; restore it to roll back.",
        confidence: Math.min(0.85, 0.45 + convConfidence + (s.days >= 4 ? 0.15 : 0)),
        score: 0,
      });
    }

    // Excessive scrolling → content/section order does not surface what users seek.
    if (scrollRate >= EXCESSIVE_SCROLL_RATE) {
      out.push({
        changeType: pageClass === "faq" ? "faq" : "section_order",
        pageUrl: s.url,
        title: `Visitors scroll excessively on ${path} without finding what they need`,
        currentState: `${s.excessiveScroll} sessions with excessive scrolling out of ${s.sessions} (${s.days} days). Key content appears to sit too deep in the page.`,
        proposedState: pageClass === "faq"
          ? "Add an indexed/searchable FAQ structure so answers are reachable without deep scrolling."
          : "Reorder sections to lift the most sought content (and a CTA) above the fold; add jump links for long pages.",
        why: `Excessive-scroll rate ${(scrollRate * 100).toFixed(1)}% exceeds ${(EXCESSIVE_SCROLL_RATE * 100).toFixed(0)}%. ${convNote}`,
        supportingData: evidence,
        expectedImpact: "Faster content discovery; higher CTA visibility. Verify with scroll-depth changes post-deploy.",
        risk: "Medium: reordering sections can affect SEO headings structure and internal anchors.",
        rollbackPlan: "Record the current section order in the change package; restore order to roll back.",
        confidence: Math.min(0.8, 0.4 + convConfidence + (s.days >= 4 ? 0.15 : 0)),
        score: 0,
      });
    }

    // Mobile-dominated problems → mobile-specific UX issue.
    if (s.mobileShareOfProblems >= MOBILE_PROBLEM_SHARE && s.deadClicks + s.rageClicks >= 10) {
      out.push({
        changeType: "cta_position",
        pageUrl: s.url,
        title: `Frustration signals on ${path} are concentrated on mobile (${Math.round(s.mobileShareOfProblems * 100)}%)`,
        currentState: `${Math.round(s.mobileShareOfProblems * 100)}% of ${s.deadClicks + s.rageClicks} dead/rage clicks come from mobile devices — tap targets or CTA placement likely break on small screens.`,
        proposedState: "Audit the page at mobile widths: enlarge tap targets to ≥44px, keep the primary CTA visible without scrolling, and fix any overlapping elements.",
        why: `Mobile share of frustration signals ${(s.mobileShareOfProblems * 100).toFixed(0)}% exceeds ${(MOBILE_PROBLEM_SHARE * 100).toFixed(0)}%. ${convNote}`,
        supportingData: evidence,
        expectedImpact: "Reduced mobile abandonment; confirm via device-split metrics after deploy.",
        risk: "Low: mobile layout fixes rarely affect desktop.",
        rollbackPlan: "Keep the current responsive CSS in the change package; restore to roll back.",
        confidence: Math.min(0.85, 0.5 + convConfidence),
        score: 0,
      });
    }
  }

  // Score = severity × confidence (deterministic, evidence-derived).
  for (const c of out) {
    const sd = (c.supportingData as any).claritySignal as PageSignal | undefined;
    const sessions = sd?.sessions ?? 0;
    const severity = Math.min(1, Math.log10(1 + sessions) / 3);
    c.score = Math.round(severity * c.confidence * 1000) / 10;
  }
  return out.sort((a, b) => b.score - a.score);
}

export function dedupeKeyForChange(c: Pick<ChangeCandidate, "changeType" | "pageUrl">): string {
  return `${c.changeType}:${pathOf(c.pageUrl)}`;
}

// ── Queue refresh (dedupe/expiry lifecycle mirrors the SEO queue) ─────────────

const DISMISS_BLOCK_DAYS = 30;
const OPEN_EXPIRE_DAYS = 14;
const MAX_INSERTS_PER_REFRESH = 30;

export async function refreshWebsiteChangeQueue(
  workspaceId: string,
  sbOverride?: SupabaseClient,
): Promise<{ ok: boolean; detected: number; inserted: number; updated: number; expired: number; error?: string }> {
  const admin = (sbOverride ?? adminClient()) as any;
  try {
    try { await reconcileWebsiteChanges(workspaceId, admin); } catch { /* non-fatal */ }

    const since = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    const { data: metricRows, error: mErr } = await admin
      .from("clarity_metrics_daily")
      .select("metric_date, url, device, sessions, metrics")
      .eq("workspace_id", workspaceId)
      .gte("metric_date", since)
      .limit(5000);
    if (mErr) return { ok: false, detected: 0, inserted: 0, updated: 0, expired: 0, error: mErr.message };
    if (!metricRows?.length) return { ok: true, detected: 0, inserted: 0, updated: 0, expired: 0 };

    // Conversion outcomes per landing path: recent 14d vs prior 14d.
    const now = Date.now();
    const recentSince = new Date(now - 14 * 86400_000).toISOString();
    const priorSince = new Date(now - 28 * 86400_000).toISOString();
    const { data: convRows } = await admin
      .from("conversion_events")
      .select("landing_url, created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", priorSince)
      .not("landing_url", "is", null)
      .limit(5000);
    const convMap = new Map<string, { recent: number; prior: number }>();
    for (const r of convRows ?? []) {
      const p = pathOf(String(r.landing_url));
      const bucket = convMap.get(p) ?? { recent: 0, prior: 0 };
      if (r.created_at >= recentSince) bucket.recent++; else bucket.prior++;
      convMap.set(p, bucket);
    }
    const conversions: ConversionByPage[] = [...convMap.entries()].map(([path, v]) => ({ path, ...v }));

    const signals = aggregateClaritySignals(metricRows);
    const candidates = detectWebsiteChanges(signals, conversions);

    // Existing rows for dedupe decisions.
    const { data: existing } = await admin
      .from("website_change_queue")
      .select("id, dedupe_key, status, status_changed_at, last_detected_at")
      .eq("workspace_id", workspaceId)
      .in("status", ["open", "executing", "handled", "dismissed"]);
    const byKey = new Map<string, any>();
    for (const row of existing ?? []) {
      const prev = byKey.get(row.dedupe_key);
      if (!prev || row.status_changed_at > prev.status_changed_at) byKey.set(row.dedupe_key, row);
    }

    const nowIso = new Date().toISOString();
    const dismissBlockedAfter = new Date(now - DISMISS_BLOCK_DAYS * 86400_000).toISOString();
    let inserted = 0, updated = 0;
    const detectedKeys = new Set<string>();

    for (const c of candidates) {
      const key = dedupeKeyForChange(c);
      detectedKeys.add(key);
      const prior = byKey.get(key);
      if (prior) {
        if (prior.status === "open") {
          const { error } = await admin.from("website_change_queue").update({
            title: c.title, current_state: c.currentState, proposed_state: c.proposedState,
            why: c.why, supporting_data: c.supportingData, expected_impact: c.expectedImpact,
            risk: c.risk, rollback_plan: c.rollbackPlan, confidence: c.confidence, score: c.score,
            last_detected_at: nowIso, updated_at: nowIso,
          }).eq("id", prior.id).eq("status", "open");
          if (!error) updated++;
        }
        // executing/handled: never re-propose. dismissed: blocked for 30 days.
        if (prior.status === "dismissed" && prior.status_changed_at > dismissBlockedAfter) continue;
        if (prior.status !== "dismissed") continue;
      }
      if (inserted >= MAX_INSERTS_PER_REFRESH) continue; // candidates are score-sorted — highest win
      const { error } = await admin.from("website_change_queue").insert({
        workspace_id: workspaceId,
        page_url: c.pageUrl, change_type: c.changeType, title: c.title,
        current_state: c.currentState, proposed_state: c.proposedState, why: c.why,
        supporting_data: c.supportingData, expected_impact: c.expectedImpact,
        risk: c.risk, rollback_plan: c.rollbackPlan,
        confidence: c.confidence, score: c.score, dedupe_key: key,
        first_detected_at: nowIso, last_detected_at: nowIso,
      });
      if (error) {
        if ((error as any).code === "23505") continue; // concurrent refresh deduped it
        return { ok: false, detected: candidates.length, inserted, updated, expired: 0, error: error.message };
      }
      inserted++;
    }

    // Expire stale open rows not re-detected for 14 days.
    const expireBefore = new Date(now - OPEN_EXPIRE_DAYS * 86400_000).toISOString();
    const { data: expiredRows } = await admin.from("website_change_queue").update({
      status: "expired", status_changed_at: nowIso, updated_at: nowIso,
    }).eq("workspace_id", workspaceId).eq("status", "open").lt("last_detected_at", expireBefore).select("id");

    return { ok: true, detected: candidates.length, inserted, updated, expired: expiredRows?.length ?? 0 };
  } catch (e: any) {
    return { ok: false, detected: 0, inserted: 0, updated: 0, expired: 0, error: String(e?.message ?? e) };
  }
}

// ── Reconciliation (failed/rejected actions must reopen queue items) ─────────

const ORPHAN_CLAIM_GRACE_MINUTES = 30;

export async function reconcileWebsiteChanges(
  workspaceId: string,
  sbOverride?: SupabaseClient,
): Promise<{ reopened: number }> {
  const admin = (sbOverride ?? adminClient()) as any;
  let reopened = 0;
  const { data: executing } = await admin
    .from("website_change_queue")
    .select("id, marketing_action_id, status_changed_at, measurement")
    .eq("workspace_id", workspaceId)
    .eq("status", "executing");
  for (const row of executing ?? []) {
    const now = new Date().toISOString();
    if (!row.marketing_action_id) {
      const claimedAt = row.status_changed_at ? new Date(row.status_changed_at).getTime() : 0;
      if (Date.now() - claimedAt < ORPHAN_CLAIM_GRACE_MINUTES * 60_000) continue;
      const { error } = await admin.from("website_change_queue").update({
        status: "open", status_changed_at: now, updated_at: now,
        measurement: { ...(row.measurement ?? {}), lastFailure: { at: now, detail: "Execution claim was never linked to a marketing action (orphaned) — reopened for retry." } },
      }).eq("id", row.id).eq("status", "executing");
      if (!error) reopened++;
      continue;
    }
    const { data: action } = await admin
      .from("marketing_actions")
      .select("id, status, status_history, approval_action_id")
      .eq("id", row.marketing_action_id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!action) continue;
    // Recover stranded rows whose bound approval was rejected.
    if (action.status === "awaiting_approval" && action.approval_action_id) {
      const { data: approval } = await admin
        .from("hivemind_actions")
        .select("status")
        .eq("id", action.approval_action_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (approval?.status === "rejected") {
        const history = Array.isArray(action.status_history) ? action.status_history : [];
        const { data: failedRows } = await admin.from("marketing_actions").update({
          status: "failed",
          error_message: "Approval rejected by user.",
          status_history: [...history, { from: "awaiting_approval", to: "failed", at: now, note: "Approval rejected by user (reconciled)" }],
          updated_at: now,
        }).eq("id", action.id).eq("status", "awaiting_approval").select("id");
        if (failedRows?.length) { action.status = "failed"; action.status_history = [...history, { note: "Approval rejected by user (reconciled)" }]; }
      }
    }
    if (action.status === "failed" || action.status === "rolled_back") {
      const history = Array.isArray(action.status_history) ? action.status_history : [];
      const lastNote = history.length > 0 ? (history[history.length - 1] as any)?.note ?? null : null;
      const { error } = await admin.from("website_change_queue").update({
        status: "open", status_changed_at: now, updated_at: now,
        measurement: { ...(row.measurement ?? {}), lastFailure: { at: now, actionStatus: action.status, detail: lastNote ?? `Marketing action ended as ${action.status}.` } },
      }).eq("id", row.id).eq("status", "executing");
      if (!error) reopened++;
    }
  }
  return { reopened };
}
