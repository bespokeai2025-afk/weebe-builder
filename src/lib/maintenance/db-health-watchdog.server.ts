/**
 * Supabase database health watchdog.
 *
 * Probes the Supabase project's health every background tick (~5 min) and
 * alerts platform admins by email the moment the database platform goes
 * unhealthy — so an outage is noticed immediately instead of when a user
 * hits a broken panel (e.g. Live Calls stuck on "reconnecting…").
 *
 * Probe strategy (in order):
 *  1. Supabase Management API — GET /v1/projects/{ref}/health?services=db,rest,auth
 *     (requires SUPABASE_ACCESS_TOKEN; authoritative platform-level signal).
 *  2. Direct PostgREST probe with the service-role key (fallback when no
 *     Management API token is configured). PGRST002 / 503 / timeouts here are
 *     the same "project down" signal.
 *
 * Alerting rules:
 *  • Requires 2 consecutive unhealthy probes before alerting (avoids blips).
 *  • Re-alerts at most once per hour while the outage persists.
 *  • Sends a recovery email once the project is healthy again.
 *  • Recipients: profiles with user_type='admin' (emails cached in-process
 *    while healthy — the DB can't be queried mid-outage), overridable via the
 *    DB_ALERT_EMAILS env var (comma-separated).
 *
 * Entirely best-effort: never throws, never blocks the tick. State is
 * in-process (single long-lived server instance in both dev and prod —
 * same assumption as the other tick sweeps in this file's directory).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendResendEmail, escapeHtml } from "@/lib/email/resend.server";

const UNHEALTHY_THRESHOLD = 2;
const REALERT_INTERVAL_MS = 60 * 60 * 1000;
const ADMIN_EMAIL_CACHE_MS = 6 * 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 15_000;

export interface ServiceHealth {
  name: string;
  healthy: boolean;
  status?: string;
  error?: string;
}

export interface DbHealthSnapshot {
  /** null until the first probe has run */
  status: "healthy" | "unhealthy" | null;
  checkedAt: string | null;
  source: "management_api" | "rest_probe" | null;
  services: ServiceHealth[];
  consecutiveFailures: number;
  /** ISO timestamp of the last admin alert email, if any */
  lastAlertAt: string | null;
  /** set while an outage is ongoing (first unhealthy probe of the streak) */
  outageStartedAt: string | null;
}

interface WatchdogState extends DbHealthSnapshot {
  alertedForCurrentOutage: boolean;
  adminEmails: string[];
  adminEmailsFetchedAt: number;
}

const state: WatchdogState = {
  status: null,
  checkedAt: null,
  source: null,
  services: [],
  consecutiveFailures: 0,
  lastAlertAt: null,
  outageStartedAt: null,
  alertedForCurrentOutage: false,
  adminEmails: [],
  adminEmailsFetchedAt: 0,
};

export function getDbHealthWatchdogSnapshot(): DbHealthSnapshot {
  return {
    status: state.status,
    checkedAt: state.checkedAt,
    source: state.source,
    services: state.services,
    consecutiveFailures: state.consecutiveFailures,
    lastAlertAt: state.lastAlertAt,
    outageStartedAt: state.outageStartedAt,
  };
}

function getProjectRef(): string | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const m = url.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1] : null;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Probe via the Supabase Management API. Returns null if not configured/usable. */
async function probeManagementApi(): Promise<{ services: ServiceHealth[] } | null> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = getProjectRef();
  if (!token || !ref) return null;
  try {
    const res = await fetchWithTimeout(
      `https://api.supabase.com/v1/projects/${ref}/health?services=db,rest,auth`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      // Management API itself failing (401/403/5xx) is NOT a DB outage signal —
      // fall through to the REST probe instead of raising a false alarm.
      console.warn(`[db-watchdog] management API probe returned ${res.status}`);
      return null;
    }
    const body = (await res.json()) as Array<{
      name?: string;
      healthy?: boolean;
      status?: string;
      error?: string;
    }>;
    if (!Array.isArray(body) || body.length === 0) return null;
    return {
      services: body.map((s) => ({
        name: String(s.name ?? "unknown"),
        healthy: s.healthy === true,
        status: s.status ? String(s.status) : undefined,
        error: s.error ? String(s.error) : undefined,
      })),
    };
  } catch (err: any) {
    console.warn("[db-watchdog] management API probe failed:", err?.message ?? err);
    return null;
  }
}

/** Fallback: direct PostgREST probe with the service-role key. */
async function probeRest(): Promise<{ services: ServiceHealth[] } | null> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetchWithTimeout(`${url}/rest/v1/workspaces?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      return { services: [{ name: "rest", healthy: true, status: `HTTP ${res.status}` }] };
    }
    const body = await res.text().catch(() => "");
    return {
      services: [
        {
          name: "rest",
          healthy: false,
          status: `HTTP ${res.status}`,
          error: body.slice(0, 300),
        },
      ],
    };
  } catch (err: any) {
    return {
      services: [
        { name: "rest", healthy: false, error: String(err?.message ?? err).slice(0, 300) },
      ],
    };
  }
}

/** Resolve platform-admin alert recipients (env override → cached DB lookup). */
async function resolveAlertEmails(dbHealthy: boolean): Promise<string[]> {
  const envOverride = (process.env.DB_ALERT_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.includes("@"));
  if (envOverride.length > 0) return envOverride;

  const now = Date.now();
  const cacheFresh = now - state.adminEmailsFetchedAt < ADMIN_EMAIL_CACHE_MS;
  if (dbHealthy && (!cacheFresh || state.adminEmails.length === 0)) {
    try {
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("email")
        .eq("user_type", "admin")
        .limit(20);
      if (!error) {
        const emails = (data ?? [])
          .map((r: any) => String(r.email ?? "").trim())
          .filter((e: string) => e.includes("@"));
        if (emails.length > 0) {
          state.adminEmails = emails;
          state.adminEmailsFetchedAt = now;
        }
      }
    } catch (err: any) {
      console.warn("[db-watchdog] admin email refresh failed:", err?.message ?? err);
    }
  }
  return state.adminEmails;
}

function formatServices(services: ServiceHealth[]): string {
  return services
    .map(
      (s) =>
        `<li><strong>${escapeHtml(s.name)}</strong>: ${s.healthy ? "healthy" : "UNHEALTHY"}` +
        (s.status ? ` (${escapeHtml(s.status)})` : "") +
        (s.error ? ` — ${escapeHtml(s.error)}` : "") +
        `</li>`,
    )
    .join("");
}

async function sendAlert(kind: "down" | "recovered", services: ServiceHealth[]): Promise<void> {
  const recipients = await resolveAlertEmails(kind === "recovered");
  if (recipients.length === 0) {
    console.warn("[db-watchdog] no alert recipients available — alert not sent");
    return;
  }

  const now = new Date().toISOString();
  const since = state.outageStartedAt;
  const ref = getProjectRef();
  const subject =
    kind === "down"
      ? "🔴 WEBEE ALERT: Supabase database is UNHEALTHY"
      : "🟢 WEBEE: Supabase database has RECOVERED";
  const html =
    kind === "down"
      ? `<h2>Supabase project unhealthy</h2>
         <p>The platform database (project <code>${escapeHtml(ref ?? "unknown")}</code>) is failing health checks${since ? ` since <strong>${escapeHtml(since)}</strong>` : ""}. The app (login, dashboards, Live Calls) is likely down for all workspaces.</p>
         <ul>${formatServices(services)}</ul>
         <p><strong>Suggested action:</strong> check the Supabase dashboard; if the project is stuck, restart it (Management API: <code>POST https://api.supabase.com/v1/projects/${escapeHtml(ref ?? "{ref}")}/restart</code>). Status usually returns to healthy in 2–5 minutes.</p>
         <p>Checked at ${escapeHtml(now)}. You will be re-alerted hourly while the outage persists.</p>`
      : `<h2>Supabase project recovered</h2>
         <p>The platform database (project <code>${escapeHtml(ref ?? "unknown")}</code>) is healthy again${since ? ` after an outage that started at <strong>${escapeHtml(since)}</strong>` : ""}.</p>
         <ul>${formatServices(services)}</ul>
         <p>Recovered at ${escapeHtml(now)}.</p>`;

  for (const to of recipients) {
    const result = await sendResendEmail({ to, subject, html });
    if (!result.success) {
      console.warn(`[db-watchdog] alert email to ${to} failed: ${result.error}`);
    }
  }
  console.log(`[db-watchdog] ${kind} alert sent to ${recipients.length} admin(s)`);
}

export interface WatchdogTickResult {
  ran: boolean;
  status: "healthy" | "unhealthy" | null;
  alerted: boolean;
}

/**
 * Run one watchdog probe. Called from the 5-minute background tick
 * (dev plugin + /api/public/campaign-executor). Never throws.
 */
export async function runDbHealthWatchdogTick(): Promise<WatchdogTickResult> {
  const out: WatchdogTickResult = { ran: false, status: state.status, alerted: false };
  try {
    let source: DbHealthSnapshot["source"] = "management_api";
    let probe = await probeManagementApi();
    if (!probe) {
      source = "rest_probe";
      probe = await probeRest();
    }
    if (!probe) return out; // nothing configured — can't probe at all

    out.ran = true;
    const healthy = probe.services.every((s) => s.healthy);
    state.checkedAt = new Date().toISOString();
    state.source = source;
    state.services = probe.services;

    if (healthy) {
      const wasAlerted = state.alertedForCurrentOutage;
      state.status = "healthy";
      state.consecutiveFailures = 0;
      if (wasAlerted) {
        await sendAlert("recovered", probe.services);
        out.alerted = true;
      }
      state.outageStartedAt = null;
      state.alertedForCurrentOutage = false;
      // Opportunistically keep the admin-email cache warm while healthy.
      await resolveAlertEmails(true);
    } else {
      state.consecutiveFailures += 1;
      if (!state.outageStartedAt) state.outageStartedAt = state.checkedAt;
      state.status = "unhealthy";
      console.error(
        `[db-watchdog] UNHEALTHY (${state.consecutiveFailures} consecutive, via ${source}):`,
        probe.services
          .filter((s) => !s.healthy)
          .map((s) => `${s.name}${s.error ? `: ${s.error}` : ""}`)
          .join("; "),
      );

      const dueFirstAlert =
        state.consecutiveFailures >= UNHEALTHY_THRESHOLD && !state.alertedForCurrentOutage;
      const dueRealert =
        state.alertedForCurrentOutage &&
        state.lastAlertAt !== null &&
        Date.now() - Date.parse(state.lastAlertAt) >= REALERT_INTERVAL_MS;

      if (dueFirstAlert || dueRealert) {
        await sendAlert("down", probe.services);
        state.lastAlertAt = new Date().toISOString();
        state.alertedForCurrentOutage = true;
        out.alerted = true;
      }
    }
    out.status = state.status;
  } catch (err: any) {
    console.warn("[db-watchdog] tick failed:", err?.message ?? err);
  }
  return out;
}
