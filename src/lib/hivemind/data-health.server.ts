// ── HiveMind Data-Source Health (server only) ────────────────────────────────
// Per-workspace, per-source freshness/degradation tracking. Purely descriptive:
// reads existing tables (provider_settings, sync_state, latest-row timestamps)
// and NEVER triggers any sync or external call. Results are cached in-process
// with a short TTL plus the platform_cache_signals cross-instance pattern so
// prompt-building doesn't re-scan tables on every message.
//
// WBAH split: for the WBAH workspace, call/lead sources derive from wbah_*
// tables (read-on-demand only) and the huge `leads` table is never queried.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkCacheSignal, bumpCacheSignal } from "@/lib/packages/cache-signals.server";

export const SIGNAL_DATA_HEALTH = "hivemind_data_health";

export type SourceStatus = "healthy" | "stale" | "degraded" | "disconnected" | "empty";

export interface DataSourceHealth {
  source: string;                    // "calls" | "leads" | "calendar" | "email" | "whatsapp" | "gads" | "billing" | "campaigns"
  status: SourceStatus;
  lastActivityAt: string | null;     // newest record / successful sync timestamp we could find
  recordsInWindow: number;           // records in the last 30 days (0 for count-unsafe tables)
  windowDays: number;
  detail: string;                    // short human-readable reason for the status
}

export interface WorkspaceDataHealth {
  computedAt: string;
  isWbah: boolean;
  sources: DataSourceHealth[];
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; version: number | null; value: WorkspaceDataHealth }>();

export function invalidateDataHealth(workspaceId?: string, opts?: { broadcast?: boolean }) {
  if (workspaceId) cache.delete(workspaceId);
  else cache.clear();
  if (opts?.broadcast !== false) void bumpCacheSignal(SIGNAL_DATA_HEALTH);
}

const HOURS = 3_600_000;

function ageStatus(last: string | null, count: number, staleHours: number): SourceStatus {
  if (!last && count === 0) return "empty";
  if (!last) return "healthy"; // has rows in window but no timestamp — treat as active
  const age = Date.now() - new Date(last).getTime();
  return age > staleHours * HOURS ? "stale" : "healthy";
}

function agoLabel(ts: string | null): string {
  if (!ts) return "no activity recorded";
  const h = Math.round((Date.now() - new Date(ts).getTime()) / HOURS);
  if (h < 1) return "active within the last hour";
  if (h < 48) return `last activity ${h}h ago`;
  return `last activity ${Math.round(h / 24)}d ago`;
}

// Count rows in a window (head count only — never fetches rows, safe on
// indexed workspace_id+timestamp columns) and the newest timestamp via an
// index-friendly ordered LIMIT 1 confined to the window.
async function probeTable(opts: {
  table: string;
  tsColumn: string;
  workspaceId: string;
  sinceIso: string;
  extraEq?: Record<string, string>;
}): Promise<{ count: number; latest: string | null; error: string | null }> {
  try {
    let cq = (supabaseAdmin as any)
      .from(opts.table)
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", opts.workspaceId)
      .gte(opts.tsColumn, opts.sinceIso);
    let lq = (supabaseAdmin as any)
      .from(opts.table)
      .select(opts.tsColumn)
      .eq("workspace_id", opts.workspaceId)
      .gte(opts.tsColumn, opts.sinceIso)
      .order(opts.tsColumn, { ascending: false })
      .limit(1);
    for (const [k, v] of Object.entries(opts.extraEq ?? {})) {
      cq = cq.eq(k, v);
      lq = lq.eq(k, v);
    }
    const [cRes, lRes] = await Promise.all([cq, lq]);
    if (cRes.error) return { count: 0, latest: null, error: cRes.error.message };
    const latest = lRes.error ? null : (lRes.data?.[0]?.[opts.tsColumn] ?? null);
    return { count: cRes.count ?? 0, latest, error: null };
  } catch (e: any) {
    return { count: 0, latest: null, error: e?.message ?? String(e) };
  }
}

export async function getWorkspaceDataHealth(
  workspaceId: string,
  isWbah: boolean,
): Promise<WorkspaceDataHealth> {
  const version = await checkCacheSignal(SIGNAL_DATA_HEALTH);
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS && hit.version === version) return hit.value;

  const windowDays = 30;
  const since = new Date(Date.now() - windowDays * 24 * HOURS).toISOString();

  // Descriptive inputs shared by several sources.
  const [syncRowsRes, providerRowsRes] = await Promise.all([
    (supabaseAdmin as any)
      .from("sync_state")
      .select("source_name,module,sync_status,last_successful_sync_at,last_attempted_sync_at,error_message")
      .eq("workspace_id", workspaceId)
      .limit(100)
      .then((r: any) => r, () => ({ data: [], error: null })),
    (supabaseAdmin as any)
      .from("provider_settings")
      .select("provider_category,provider_name,status,last_sync")
      .eq("workspace_id", workspaceId)
      .limit(100)
      .then((r: any) => r, () => ({ data: [], error: null })),
  ]);
  const syncRows: any[] = syncRowsRes.data ?? [];
  const providerRows: any[] = providerRowsRes.data ?? [];

  const syncFor = (needle: string) =>
    syncRows.filter((r) => `${r.source_name}/${r.module}`.toLowerCase().includes(needle));
  const providerFor = (category: string) =>
    providerRows.filter((r) => r.provider_category === category);

  function mergeSync(base: DataSourceHealth, needle: string): DataSourceHealth {
    const rows = syncFor(needle);
    if (!rows.length) return base;
    const failing = rows.filter((r) => r.sync_status === "error");
    const newestOk = rows
      .map((r) => r.last_successful_sync_at)
      .filter(Boolean)
      .sort()
      .pop() as string | undefined;
    if (newestOk && (!base.lastActivityAt || newestOk > base.lastActivityAt)) {
      base.lastActivityAt = newestOk;
    }
    if (failing.length) {
      base.status = "degraded";
      base.detail = `last sync failed: ${String(failing[0].error_message ?? "unknown error").slice(0, 140)}`;
    }
    return base;
  }

  const probes: Promise<DataSourceHealth>[] = [];

  // ── calls ──
  probes.push((async (): Promise<DataSourceHealth> => {
    const p = await probeTable({
      table: isWbah ? "wbah_calls" : "calls",
      tsColumn: "started_at",
      workspaceId,
      sinceIso: since,
    });
    if (p.error) return { source: "calls", status: "degraded", lastActivityAt: null, recordsInWindow: 0, windowDays, detail: `read failed: ${p.error.slice(0, 140)}` };
    const base: DataSourceHealth = {
      source: "calls",
      status: ageStatus(p.latest, p.count, isWbah ? 72 : 168),
      lastActivityAt: p.latest,
      recordsInWindow: p.count,
      windowDays,
      detail: `${p.count} calls in last ${windowDays}d (${isWbah ? "wbah_calls" : "calls"}); ${agoLabel(p.latest)}`,
    };
    return mergeSync(base, isWbah ? "call" : "retell");
  })());

  // ── leads ──
  probes.push((async (): Promise<DataSourceHealth> => {
    if (isWbah) {
      // NEVER query the dup-inflated WBAH leads table (statement-timeout trap).
      // WBAH "leads" derive from wbah_calls; report freshness of that derivation.
      const p = await probeTable({ table: "wbah_calls", tsColumn: "started_at", workspaceId, sinceIso: since });
      const base: DataSourceHealth = {
        source: "leads",
        status: p.error ? "degraded" : ageStatus(p.latest, p.count, 72),
        lastActivityAt: p.latest,
        recordsInWindow: p.count,
        windowDays,
        detail: p.error
          ? `read failed: ${p.error.slice(0, 140)}`
          : `derived on demand from wbah_calls (${p.count} calls in ${windowDays}d); ${agoLabel(p.latest)}`,
      };
      return mergeSync(base, "lead");
    }
    const p = await probeTable({ table: "leads", tsColumn: "created_at", workspaceId, sinceIso: since });
    if (p.error) return { source: "leads", status: "degraded", lastActivityAt: null, recordsInWindow: 0, windowDays, detail: `read failed: ${p.error.slice(0, 140)}` };
    return mergeSync({
      source: "leads",
      status: ageStatus(p.latest, p.count, 168),
      lastActivityAt: p.latest,
      recordsInWindow: p.count,
      windowDays,
      detail: `${p.count} new leads in last ${windowDays}d; ${agoLabel(p.latest)}`,
    }, "lead");
  })());

  // ── calendar ──
  probes.push((async (): Promise<DataSourceHealth> => {
    if (isWbah) {
      // WBAH split: WBAH bookings live in wbah_calls appointment fields —
      // calendar_bookings is intentionally empty for WBAH and must not drive
      // its calendar health.
      try {
        const [cRes, lRes] = await Promise.all([
          (supabaseAdmin as any)
            .from("wbah_calls")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", workspaceId)
            .not("appointment_date", "is", null)
            .gte("started_at", since),
          (supabaseAdmin as any)
            .from("wbah_calls")
            .select("started_at")
            .eq("workspace_id", workspaceId)
            .not("appointment_date", "is", null)
            .gte("started_at", since)
            .order("started_at", { ascending: false })
            .limit(1),
        ]);
        if (cRes.error) throw new Error(cRes.error.message);
        const count = cRes.count ?? 0;
        const latest = lRes.error ? null : (lRes.data?.[0]?.started_at ?? null);
        return mergeSync({
          source: "calendar",
          status: ageStatus(latest, count, 24 * 14),
          lastActivityAt: latest,
          recordsInWindow: count,
          windowDays,
          detail: `derived from wbah_calls appointment fields (${count} booked calls in last ${windowDays}d); ${agoLabel(latest)}`,
        }, "calendar");
      } catch (e: any) {
        return { source: "calendar", status: "degraded", lastActivityAt: null, recordsInWindow: 0, windowDays, detail: `read failed: ${String(e?.message ?? e).slice(0, 140)}` };
      }
    }
    const p = await probeTable({ table: "calendar_bookings", tsColumn: "created_at", workspaceId, sinceIso: since });
    if (p.error) return { source: "calendar", status: "degraded", lastActivityAt: null, recordsInWindow: 0, windowDays, detail: `read failed: ${p.error.slice(0, 140)}` };
    const calProviders = providerFor("calendar");
    const connected = calProviders.some((r) => r.status === "connected");
    const status: SourceStatus =
      p.count === 0 && !connected && calProviders.length > 0 ? "disconnected" : ageStatus(p.latest, p.count, 24 * 14);
    return mergeSync({
      source: "calendar",
      status,
      lastActivityAt: p.latest,
      recordsInWindow: p.count,
      windowDays,
      detail: `${p.count} bookings created in last ${windowDays}d; ${agoLabel(p.latest)}${calProviders.length ? `; provider status: ${calProviders.map((r) => `${r.provider_name}=${r.status}`).join(", ")}` : ""}`,
    }, "calendar");
  })());

  // ── email ──
  probes.push((async (): Promise<DataSourceHealth> => {
    const p = await probeTable({ table: "lead_email_log", tsColumn: "created_at", workspaceId, sinceIso: since });
    if (p.error) return { source: "email", status: "degraded", lastActivityAt: null, recordsInWindow: 0, windowDays, detail: `read failed: ${p.error.slice(0, 140)}` };
    return mergeSync({
      source: "email",
      status: p.count === 0 && !p.latest ? "empty" : "healthy",
      lastActivityAt: p.latest,
      recordsInWindow: p.count,
      windowDays,
      detail: `${p.count} lead emails sent in last ${windowDays}d; ${agoLabel(p.latest)}`,
    }, "email");
  })());

  // ── whatsapp ──
  probes.push((async (): Promise<DataSourceHealth> => {
    const p = await probeTable({ table: "whatsapp_messages", tsColumn: "created_at", workspaceId, sinceIso: since });
    if (p.error) return { source: "whatsapp", status: "degraded", lastActivityAt: null, recordsInWindow: 0, windowDays, detail: `read failed: ${p.error.slice(0, 140)}` };
    const waProviders = providerFor("whatsapp");
    const status: SourceStatus =
      p.count === 0 && waProviders.length > 0 && !waProviders.some((r) => r.status === "connected")
        ? "disconnected"
        : p.count === 0 && !p.latest ? "empty" : ageStatus(p.latest, p.count, 24 * 14);
    return mergeSync({
      source: "whatsapp",
      status,
      lastActivityAt: p.latest,
      recordsInWindow: p.count,
      windowDays,
      detail: `${p.count} messages in last ${windowDays}d; ${agoLabel(p.latest)}`,
    }, "whatsapp");
  })());

  // ── gads (ad platforms) ──
  probes.push((async (): Promise<DataSourceHealth> => {
    try {
      const { data, error } = await (supabaseAdmin as any)
        .from("growthmind_ads_accounts")
        .select("platform,label,status,sync_status,last_synced_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .limit(20);
      if (error) throw new Error(error.message);
      const accts: any[] = data ?? [];
      if (!accts.length) return { source: "gads", status: "empty", lastActivityAt: null, recordsInWindow: 0, windowDays, detail: "no ad accounts connected" };
      const newest = accts.map((a) => a.last_synced_at).filter(Boolean).sort().pop() ?? null;
      const failing = accts.filter((a) => a.sync_status === "error");
      const status: SourceStatus = failing.length
        ? "degraded"
        : ageStatus(newest, accts.length, 48);
      return {
        source: "gads",
        status,
        lastActivityAt: newest,
        recordsInWindow: accts.length,
        windowDays,
        detail: failing.length
          ? `${failing.length}/${accts.length} ad account(s) failing to sync`
          : `${accts.length} ad account(s); ${agoLabel(newest)}`,
      };
    } catch (e: any) {
      return { source: "gads", status: "degraded", lastActivityAt: null, recordsInWindow: 0, windowDays, detail: `read failed: ${String(e?.message ?? e).slice(0, 140)}` };
    }
  })());

  // ── billing ──
  probes.push((async (): Promise<DataSourceHealth> => {
    try {
      const { data, error } = await (supabaseAdmin as any)
        .from("client_monthly_costs")
        .select("month,computed_at")
        .eq("workspace_id", workspaceId)
        .order("month", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return { source: "billing", status: "empty", lastActivityAt: null, recordsInWindow: 0, windowDays, detail: "no monthly cost snapshots computed yet" };
      const status = ageStatus(data.computed_at ?? null, 1, 24 * 45);
      return {
        source: "billing",
        status,
        lastActivityAt: data.computed_at ?? null,
        recordsInWindow: 1,
        windowDays,
        detail: `latest cost snapshot for ${data.month}; ${agoLabel(data.computed_at ?? null)}`,
      };
    } catch (e: any) {
      return { source: "billing", status: "degraded", lastActivityAt: null, recordsInWindow: 0, windowDays, detail: `read failed: ${String(e?.message ?? e).slice(0, 140)}` };
    }
  })());

  // ── campaigns ──
  probes.push((async (): Promise<DataSourceHealth> => {
    const p = await probeTable({ table: "call_campaigns", tsColumn: "created_at", workspaceId, sinceIso: since });
    if (p.error) return { source: "campaigns", status: "degraded", lastActivityAt: null, recordsInWindow: 0, windowDays, detail: `read failed: ${p.error.slice(0, 140)}` };
    return {
      source: "campaigns",
      status: p.count === 0 && !p.latest ? "empty" : "healthy",
      lastActivityAt: p.latest,
      recordsInWindow: p.count,
      windowDays,
      detail: `${p.count} campaigns created in last ${windowDays}d; ${agoLabel(p.latest)}`,
    };
  })());

  const sources = await Promise.all(probes);
  const value: WorkspaceDataHealth = {
    computedAt: new Date().toISOString(),
    isWbah,
    sources,
  };
  cache.set(workspaceId, { at: Date.now(), version, value });
  return value;
}
