/**
 * GSC Sync Core — workspace-aware, idempotent Search Console sync engine.
 *
 * ALIAS-FREE (no "@/" imports): this module is loaded from the campaign-scheduler
 * Vite plugin chain at config time, like blog-draft-tick.ts.
 *
 * Behaviour rules (master programme §1–2):
 *  - Empty Search Analytics on a new property is NOT a failure → status "baseline_pending".
 *  - Never invent metrics; store only rows Google returned.
 *  - Initial sync imports available history once; afterwards incremental syncs
 *    re-request only a trailing window (GSC data finalises ~2–3 days late).
 *  - All writes via service-role (tables are server-write-only).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const GSC_DIMENSIONS = ["query", "page", "country", "device", "search_appearance"] as const;
export type GscDimension = (typeof GSC_DIMENSIONS)[number];

const API_DIM: Record<GscDimension, string> = {
  query: "query",
  page: "page",
  country: "country",
  device: "device",
  search_appearance: "searchAppearance",
};

const ROW_LIMIT = 25000;
/** GSC search analytics data typically finalises ~2 days behind. */
const DATA_LAG_DAYS = 2;
/** Incremental syncs re-request this trailing window to pick up late-finalising rows. */
const INCREMENTAL_WINDOW_DAYS = 7;
/** Initial import depth (GSC retains ~16 months). */
const INITIAL_DAYS = 480;

function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

function fmtDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return fmtDate(d);
}

export function encodeGscSite(propertyUrl: string): string {
  return encodeURIComponent(propertyUrl.trim());
}

// ── Token handling ────────────────────────────────────────────────────────────

export type GscConnection = {
  accessToken: string;
  propertyUrl: string | null;
  refreshAvailable: boolean;
  tokenExpiry: string | null;
  lastRefreshAt: string | null;
};

export async function getValidGscToken(workspaceId: string, sb?: SupabaseClient): Promise<GscConnection> {
  const admin = sb ?? adminClient();
  const { data, error } = await admin
    .from("workspace_settings")
    .select("gsc_access_token, gsc_refresh_token, gsc_token_expiry, gsc_property_url")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.gsc_access_token) throw new Error("Google Search Console is not connected for this workspace");

  let accessToken: string = data.gsc_access_token;
  let lastRefreshAt: string | null = null;
  let tokenExpiry: string | null = data.gsc_token_expiry ?? null;

  const needsRefresh =
    data.gsc_token_expiry && Date.now() > new Date(data.gsc_token_expiry).getTime() - 60_000;

  if (needsRefresh && data.gsc_refresh_token) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Google OAuth credentials not configured");
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: data.gsc_refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (!res.ok) throw new Error("Failed to refresh Search Console token");
    const tokens = (await res.json()) as { access_token: string; expires_in: number };
    accessToken = tokens.access_token;
    tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    lastRefreshAt = new Date().toISOString();
    await admin
      .from("workspace_settings")
      .upsert(
        { workspace_id: workspaceId, gsc_access_token: accessToken, gsc_token_expiry: tokenExpiry },
        { onConflict: "workspace_id" },
      );
  }

  return {
    accessToken,
    propertyUrl: data.gsc_property_url ?? null,
    refreshAvailable: !!data.gsc_refresh_token,
    tokenExpiry,
    lastRefreshAt,
  };
}

// ── Low-level API calls ───────────────────────────────────────────────────────

async function gscFetch(url: string, token: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = json?.error?.message ?? text.slice(0, 200);
    const err: any = new Error(`GSC API ${res.status}: ${msg}`);
    err.status = res.status;
    err.gscReason = json?.error?.status ?? null;
    throw err;
  }
  return json;
}

export async function fetchSearchAnalytics(opts: {
  token: string;
  propertyUrl: string;
  startDate: string;
  endDate: string;
  dimensions: string[];
  startRow?: number;
  rowLimit?: number;
}): Promise<{ rows: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }> }> {
  const json = await gscFetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeGscSite(opts.propertyUrl)}/searchAnalytics/query`,
    opts.token,
    {
      method: "POST",
      body: JSON.stringify({
        startDate: opts.startDate,
        endDate: opts.endDate,
        dimensions: opts.dimensions,
        rowLimit: opts.rowLimit ?? ROW_LIMIT,
        startRow: opts.startRow ?? 0,
      }),
    },
  );
  return { rows: json?.rows ?? [] };
}

export async function fetchSitemapList(token: string, propertyUrl: string): Promise<any[]> {
  const json = await gscFetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeGscSite(propertyUrl)}/sitemaps`,
    token,
  );
  return json?.sitemap ?? [];
}

export async function fetchUrlInspection(token: string, propertyUrl: string, inspectionUrl: string): Promise<any> {
  const json = await gscFetch(
    "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
    token,
    { method: "POST", body: JSON.stringify({ inspectionUrl, siteUrl: propertyUrl }) },
  );
  return json?.inspectionResult ?? null;
}

export async function submitSitemapToGsc(token: string, propertyUrl: string, sitemapUrl: string): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeGscSite(propertyUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
    { method: "PUT", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sitemap submission failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

// ── Sync engine ───────────────────────────────────────────────────────────────

export type GscSyncResult = {
  ok: boolean;
  workspaceId: string;
  propertyUrl: string;
  kind: "initial" | "incremental";
  dateRange: { start: string; end: string };
  rowsImported: number;
  rowsByDimension: Record<string, number>;
  sitemapsFound: number;
  baselinePending: boolean;
  apiRequests: number;
  warnings: string[];
  error?: string;
  nextSyncAt: string;
};

export async function runGscSyncForWorkspace(
  workspaceId: string,
  opts?: { forceKind?: "initial" | "incremental" },
): Promise<GscSyncResult> {
  const admin = adminClient();
  const warnings: string[] = [];
  let apiRequests = 0;

  const conn = await getValidGscToken(workspaceId, admin);
  if (!conn.propertyUrl) throw new Error("No Search Console property selected for this workspace");
  const propertyUrl = conn.propertyUrl;

  // Load or create sync state (idempotency anchor).
  const { data: existing } = await admin
    .from("growthmind_gsc_sync_state")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("property_url", propertyUrl)
    .maybeSingle();

  const kind: "initial" | "incremental" =
    opts?.forceKind ?? (existing?.last_complete_date ? "incremental" : "initial");

  const endDate = daysAgo(DATA_LAG_DAYS);
  const startDate =
    kind === "initial"
      ? daysAgo(INITIAL_DAYS)
      : fmtDate(new Date(Math.min(
          new Date(existing!.last_complete_date).getTime() - (INCREMENTAL_WINDOW_DAYS - 1) * 86400_000,
          new Date(endDate).getTime(),
        )));

  const nextSyncAt = new Date(Date.now() + 24 * 3600_000).toISOString();

  const baseState = {
    workspace_id: workspaceId,
    property_url: propertyUrl,
    sync_kind: kind,
    requested_start_date: startDate,
    requested_end_date: endDate,
    updated_at: new Date().toISOString(),
  };

  await admin.from("growthmind_gsc_sync_state").upsert(
    { ...baseState, status: "syncing" },
    { onConflict: "workspace_id,property_url" },
  );

  try {
    let totalRows = 0;
    const rowsByDimension: Record<string, number> = {};
    let maxDateSeen: string | null = null;

    for (const dim of GSC_DIMENSIONS) {
      let startRow = 0;
      let dimRows = 0;
      // paginate
      for (;;) {
        apiRequests++;
        let rows: Awaited<ReturnType<typeof fetchSearchAnalytics>>["rows"];
        try {
          // searchAppearance cannot be combined with other dimensions —
          // fetched alone as a range aggregate (stored under the range end date).
          const dims = dim === "search_appearance" ? [API_DIM[dim]] : ["date", API_DIM[dim]];
          const res = await fetchSearchAnalytics({
            token: conn.accessToken,
            propertyUrl,
            startDate,
            endDate,
            dimensions: dims,
            startRow,
          });
          rows = dim === "search_appearance"
            ? res.rows.map((r) => ({ ...r, keys: [endDate, r.keys[0]] }))
            : res.rows;
        } catch (e: any) {
          if (dim === "search_appearance") {
            warnings.push(`search_appearance dimension unavailable: ${e?.message ?? e}`);
            rows = [];
          } else if (e?.status === 429) {
            warnings.push(`Quota limit reached while syncing ${dim}; partial data stored, retry scheduled.`);
            rows = [];
          } else {
            throw e;
          }
        }
        if (rows.length === 0) break;

        const upserts = rows.map((r) => {
          const date = r.keys[0];
          if (!maxDateSeen || date > maxDateSeen) maxDateSeen = date;
          return {
            workspace_id: workspaceId,
            property_url: propertyUrl,
            date,
            dimension: dim,
            dim_key: (r.keys[1] ?? "").slice(0, 2000),
            clicks: r.clicks ?? 0,
            impressions: r.impressions ?? 0,
            ctr: r.ctr ?? null,
            position: r.position ?? null,
            updated_at: new Date().toISOString(),
          };
        });

        // chunked idempotent upserts
        for (let i = 0; i < upserts.length; i += 500) {
          const { error } = await admin
            .from("growthmind_gsc_performance")
            .upsert(upserts.slice(i, i + 500), {
              onConflict: "workspace_id,property_url,date,dimension,dim_key",
            });
          if (error) throw new Error(`Failed storing ${dim} rows: ${error.message}`);
        }

        dimRows += rows.length;
        totalRows += rows.length;
        if (rows.length < ROW_LIMIT) break;
        startRow += rows.length;
      }
      rowsByDimension[dim] = dimRows;
    }

    // Sitemaps
    let sitemapsFound = 0;
    try {
      apiRequests++;
      const sitemaps = await fetchSitemapList(conn.accessToken, propertyUrl);
      sitemapsFound = sitemaps.length;
      for (const sm of sitemaps) {
        await admin.from("growthmind_gsc_sitemaps").upsert(
          {
            workspace_id: workspaceId,
            property_url: propertyUrl,
            path: sm.path,
            last_submitted: sm.lastSubmitted ?? null,
            last_downloaded: sm.lastDownloaded ?? null,
            is_pending: !!sm.isPending,
            is_index: !!sm.isSitemapsIndex,
            errors: Number(sm.errors ?? 0),
            warnings: Number(sm.warnings ?? 0),
            contents: sm.contents ?? null,
            fetched_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "workspace_id,property_url,path" },
        );
      }
      if (sitemapsFound === 0) warnings.push("No sitemaps submitted to Search Console for this property yet.");
    } catch (e: any) {
      warnings.push(`Sitemap listing failed: ${e?.message ?? e}`);
    }

    const baselinePending = totalRows === 0;
    if (baselinePending) {
      warnings.push(
        "Google returned no Search Analytics rows yet — the property is newly verified and Google is still processing performance data. This is not a connection failure.",
      );
    }

    await admin.from("growthmind_gsc_sync_state").upsert(
      {
        ...baseState,
        status: baselinePending ? "baseline_pending" : "completed",
        baseline_pending: baselinePending,
        last_complete_date: maxDateSeen ?? existing?.last_complete_date ?? null,
        rows_imported: totalRows,
        quota: { apiRequests, rowLimitPerRequest: ROW_LIMIT },
        warnings,
        retry_state: null,
        error_message: null,
        connection: {
          refreshAvailable: conn.refreshAvailable,
          tokenExpiry: conn.tokenExpiry,
          lastRefreshAt: conn.lastRefreshAt,
          lastApiCallAt: new Date().toISOString(),
        },
        freshness: {
          dataLagDays: DATA_LAG_DAYS,
          lastCompleteGoogleDate: maxDateSeen,
          note: "Search Console data is not real-time; Google finalises rows ~2-3 days late.",
        },
        last_synced_at: new Date().toISOString(),
        next_sync_at: nextSyncAt,
      },
      { onConflict: "workspace_id,property_url" },
    );

    return {
      ok: true,
      workspaceId,
      propertyUrl,
      kind,
      dateRange: { start: startDate, end: endDate },
      rowsImported: totalRows,
      rowsByDimension,
      sitemapsFound,
      baselinePending,
      apiRequests,
      warnings,
      nextSyncAt,
    };
  } catch (e: any) {
    const message = e?.message ?? String(e);
    await admin.from("growthmind_gsc_sync_state").upsert(
      {
        ...baseState,
        status: "failed",
        error_message: message,
        retry_state: { retryable: true, lastError: message, failedAt: new Date().toISOString() },
        warnings,
        next_sync_at: new Date(Date.now() + 3600_000).toISOString(),
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,property_url" },
    );
    return {
      ok: false,
      workspaceId,
      propertyUrl,
      kind,
      dateRange: { start: startDate, end: endDate },
      rowsImported: 0,
      rowsByDimension: {},
      sitemapsFound: 0,
      baselinePending: false,
      apiRequests,
      warnings,
      error: message,
      nextSyncAt,
    };
  }
}

// ── URL Inspection (selective, quota-respecting) ─────────────────────────────

export async function inspectAndStoreUrl(workspaceId: string, url: string): Promise<{
  ok: boolean;
  verdict?: string | null;
  coverageState?: string | null;
  error?: string;
}> {
  const admin = adminClient();
  try {
    const conn = await getValidGscToken(workspaceId, admin);
    if (!conn.propertyUrl) throw new Error("No Search Console property selected");
    const r = await fetchUrlInspection(conn.accessToken, conn.propertyUrl, url);
    const idx = r?.indexStatusResult ?? {};
    await admin.from("growthmind_gsc_inspections").upsert(
      {
        workspace_id: workspaceId,
        property_url: conn.propertyUrl,
        url,
        verdict: idx.verdict ?? null,
        coverage_state: idx.coverageState ?? null,
        robots_txt_state: idx.robotsTxtState ?? null,
        indexing_state: idx.indexingState ?? null,
        page_fetch_state: idx.pageFetchState ?? null,
        last_crawl_time: idx.lastCrawlTime ?? null,
        google_canonical: idx.googleCanonical ?? null,
        user_canonical: idx.userCanonical ?? null,
        raw: r ?? null,
        inspected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,property_url,url" },
    );
    return { ok: true, verdict: idx.verdict ?? null, coverageState: idx.coverageState ?? null };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

// ── Scheduler tick ────────────────────────────────────────────────────────────

export async function runGscSyncTick(): Promise<{
  ran: Array<{ workspaceId: string; rows: number; baselinePending: boolean }>;
  skipped: number;
  failed: Array<{ workspaceId: string; error: string }>;
}> {
  const admin = adminClient();
  const ran: Array<{ workspaceId: string; rows: number; baselinePending: boolean }> = [];
  const failed: Array<{ workspaceId: string; error: string }> = [];
  let skipped = 0;

  // Workspaces with a connected GSC property.
  const { data: connected } = await admin
    .from("workspace_settings")
    .select("workspace_id, gsc_property_url")
    .not("gsc_access_token", "is", null)
    .not("gsc_property_url", "is", null);

  for (const ws of connected ?? []) {
    try {
      const { data: state } = await admin
        .from("growthmind_gsc_sync_state")
        .select("status, next_sync_at")
        .eq("workspace_id", ws.workspace_id)
        .eq("property_url", ws.gsc_property_url)
        .maybeSingle();

      const due = !state || !state.next_sync_at || new Date(state.next_sync_at).getTime() <= Date.now();
      if (!due || state?.status === "syncing") { skipped++; continue; }

      // CAS claim: only proceed if we flip next_sync_at forward first (multi-instance safe).
      if (state) {
        const { data: claimed } = await admin
          .from("growthmind_gsc_sync_state")
          .update({ next_sync_at: new Date(Date.now() + 24 * 3600_000).toISOString() })
          .eq("workspace_id", ws.workspace_id)
          .eq("property_url", ws.gsc_property_url)
          .eq("next_sync_at", state.next_sync_at)
          .select("id");
        if (state.next_sync_at && (!claimed || claimed.length === 0)) { skipped++; continue; }
      }

      const result = await runGscSyncForWorkspace(ws.workspace_id);
      if (result.ok) ran.push({ workspaceId: ws.workspace_id, rows: result.rowsImported, baselinePending: result.baselinePending });
      else failed.push({ workspaceId: ws.workspace_id, error: result.error ?? "unknown" });
    } catch (e: any) {
      failed.push({ workspaceId: ws.workspace_id, error: e?.message ?? String(e) });
    }
  }

  return { ran, skipped, failed };
}
