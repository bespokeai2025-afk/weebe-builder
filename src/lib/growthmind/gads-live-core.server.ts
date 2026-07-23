/**
 * GrowthMind Google Ads — live integration CORE engine (SERVER ONLY).
 *
 * Repairs/upgrades the existing Google Ads integration:
 *  - OAuth refresh-token flow (credentials in provider_settings, google_ads row)
 *  - Account discovery via customers:listAccessibleCustomers + customer_client
 *  - Honest 4-stage connection state: oauth_connected → api_verified →
 *    account_selected → sync_healthy (never a misleading "active")
 *  - Incremental, date-segmented GAQL sync into growthmind_gads_campaign_daily
 *    + supporting entities in growthmind_gads_dimension_stats
 *  - Structured sync runs (growthmind_gads_sync_runs) with overlap prevention
 *  - Deterministic post-sync analysis producing approval-gated recommendations.
 *    Approving a recommendation ONLY creates a change-request row — this module
 *    NEVER writes to live Google Ads campaigns.
 */
// NOTE: This module must stay free of "@/" alias imports and TanStack imports —
// it is (indirectly) loaded by the vite-config-time ads sync tick, where only
// plain relative/node imports resolve. Server functions live in gads-live.server.ts.
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
let _admin: any = null;
function admin(): any {
  if (!_admin) _admin = createClient(supabaseUrl, supabaseServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return _admin;
}

// Single source of truth for the Google Ads API version across the codebase.
// v20 was sunset by Google (UNSUPPORTED_VERSION — requests blocked); v21+ works.
export const GADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION?.trim() || "v21";
export const GADS_BASE = `https://googleads.googleapis.com/${GADS_API_VERSION}`;

// ── Credential loading ────────────────────────────────────────────────────────

export interface GadsCreds {
  clientId?:       string;
  clientSecret?:   string;
  developerToken?: string;
  refreshToken?:   string;
  managerId?:      string;
}

export async function loadGadsCreds(workspaceId: string): Promise<GadsCreds> {
  const sb = admin();
  const { data } = await sb
    .from("provider_settings")
    .select("credentials")
    .eq("workspace_id", workspaceId)
    .eq("provider_category", "advertising")
    .eq("provider_name", "google_ads")
    .maybeSingle();
  const c = (data?.credentials ?? {}) as Record<string, string>;
  return {
    clientId:       c.clientId?.trim() || undefined,
    clientSecret:   c.clientSecret?.trim() || undefined,
    developerToken: c.developerToken?.trim() || undefined,
    refreshToken:   c.refreshToken?.trim() || undefined,
    managerId:      c.managerId?.trim() || undefined,
  };
}

// Short-lived access token cache (per workspace, in-process).
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
// Single-flight guard: only one refresh request per workspace at a time.
const tokenInFlight = new Map<string, Promise<string>>();

/** Test-only: expire/clear the cached access token so the next call must refresh. */
export function __expireGadsTokenCache(workspaceId?: string): void {
  if (workspaceId) tokenCache.delete(workspaceId);
  else tokenCache.clear();
}

export async function getGadsAccessToken(workspaceId: string, creds?: GadsCreds): Promise<string> {
  const cached = tokenCache.get(workspaceId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  // Coalesce concurrent callers onto a single refresh request.
  const inflight = tokenInFlight.get(workspaceId);
  if (inflight) return inflight;

  const p = (async () => {
    const c = creds ?? await loadGadsCreds(workspaceId);
    if (!c.refreshToken) throw new Error("GADS_NOT_CONNECTED: no Google refresh token — complete Connect with Google first");
    if (!c.clientId || !c.clientSecret) throw new Error("GADS_NOT_CONNECTED: OAuth Client ID/Secret missing in provider settings");

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "refresh_token",
        refresh_token: c.refreshToken,
        client_id:     c.clientId,
        client_secret: c.clientSecret,
      }),
    });
    const json = await res.json().catch(() => ({})) as any;
    if (!res.ok || json.error) {
      tokenCache.delete(workspaceId);
      if (json.error === "invalid_grant") {
        throw new Error("GADS_TOKEN_REVOKED: Google access was revoked or expired — reconnect with Google");
      }
      throw new Error(`GADS_OAUTH_ERROR: ${json.error_description ?? json.error ?? res.status}`);
    }
    const token = json.access_token as string;
    tokenCache.set(workspaceId, { token, expiresAt: Date.now() + Math.min(Number(json.expires_in ?? 3600), 3600) * 1000 });
    return token;
  })();

  tokenInFlight.set(workspaceId, p);
  try {
    return await p;
  } finally {
    tokenInFlight.delete(workspaceId);
  }
}

// ── Low-level API helpers (retry/backoff on 429/5xx) ──────────────────────────

async function gadsFetch(url: string, init: RequestInit, attempt = 0): Promise<Response> {
  const res = await fetch(url, init);
  if ((res.status === 429 || res.status >= 500) && attempt < 2) {
    await new Promise(r => setTimeout(r, 500 * Math.pow(3, attempt)));
    return gadsFetch(url, init, attempt + 1);
  }
  return res;
}

/** Extract structured GoogleAdsFailure details (error codes, messages, requestId). */
export function parseGoogleAdsFailure(body: string): { codes: string[]; messages: string[]; requestId: string | null } {
  try {
    const json = JSON.parse(body);
    const details: any[] = json?.error?.details ?? [];
    const codes: string[] = [];
    const messages: string[] = [];
    let requestId: string | null = null;
    for (const d of details) {
      if (d.requestId) requestId = d.requestId;
      for (const e of d.errors ?? []) {
        const codeObj = e.errorCode ?? {};
        for (const k of Object.keys(codeObj)) codes.push(`${k}:${codeObj[k]}`);
        if (e.message) messages.push(String(e.message));
      }
    }
    return { codes, messages, requestId };
  } catch {
    return { codes: [], messages: [], requestId: null };
  }
}

function friendlyApiError(status: number, body: string): string {
  const parsed = parseGoogleAdsFailure(body);
  if (parsed.codes.length || parsed.messages.length) {
    // Structured server-side log (no tokens/secrets — only error metadata)
    console.error("[gads] GoogleAdsFailure", JSON.stringify({
      apiVersion: GADS_API_VERSION,
      httpStatus:  status,
      errorCodes:  parsed.codes,
      messages:    parsed.messages.map(m => m.slice(0, 200)),
      requestId:   parsed.requestId,
    }));
    if (parsed.codes.some(c => c.endsWith("UNSUPPORTED_VERSION"))) {
      return `Google Ads API version ${GADS_API_VERSION} is no longer supported by Google — set GOOGLE_ADS_API_VERSION to a current version. (${parsed.messages[0] ?? ""})`.trim();
    }
    const b0 = body;
    if (!b0.includes("DEVELOPER_TOKEN") && !b0.includes("CUSTOMER_NOT_FOUND") && !b0.includes("USER_PERMISSION_DENIED") && !b0.includes("NOT_ADS_USER")) {
      return `Google Ads error [${parsed.codes.join(", ") || status}]: ${(parsed.messages[0] ?? "request failed").slice(0, 200)}${parsed.requestId ? ` (request ${parsed.requestId})` : ""}`;
    }
  }
  const b = body.slice(0, 400);
  if (b.includes("DEVELOPER_TOKEN_NOT_APPROVED")) return "Google Ads developer token is not approved for this account level (test tokens can only access test accounts).";
  if (b.includes("DEVELOPER_TOKEN_PROHIBITED"))   return "Developer token is prohibited from accessing this account.";
  if (b.includes("CUSTOMER_NOT_FOUND"))           return "Google Ads customer account not found — re-select your advertising account.";
  if (b.includes("USER_PERMISSION_DENIED"))       return "The connected Google user does not have access to this Google Ads account.";
  if (b.includes("NOT_ADS_USER"))                 return "The connected Google account is not a Google Ads user.";
  if (status === 401) return "Google authorisation expired or revoked — reconnect with Google.";
  if (status === 404) return `Google Ads API endpoint/customer not found (HTTP 404).`;
  if (status === 429) return "Google Ads API quota exceeded — will retry on the next sync.";
  return `Google Ads API ${status}: ${b.replace(/\s+/g, " ").slice(0, 200)}`;
}

export interface GaqlOptions {
  workspaceId:      string;
  customerId:       string;          // digits only or with dashes
  loginCustomerId?: string | null;   // manager (MCC) id when applicable
  creds?:           GadsCreds;
}

/** Normalise a Google Ads customer ID: strip hyphens/spaces/"customers/" prefix; must be all digits. */
export function normalizeGadsCustomerId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = String(raw).replace(/^customers\//, "").replace(/[-\s]/g, "");
  if (!/^\d{5,12}$/.test(v)) return null; // rejects emails and any non-numeric identity
  return v;
}

/** Run a GAQL query via googleAds:search with pagination. */
export async function gaqlSearch(opts: GaqlOptions, query: string): Promise<any[]> {
  const creds = opts.creds ?? await loadGadsCreds(opts.workspaceId);
  if (!creds.developerToken) throw new Error("GADS_NO_DEV_TOKEN: Google Ads developer token missing in provider settings");
  const token = await getGadsAccessToken(opts.workspaceId, creds);
  const cid   = normalizeGadsCustomerId(opts.customerId);
  if (!cid) throw new Error(`GADS_BAD_CUSTOMER_ID: "${String(opts.customerId).slice(0, 40)}" is not a numeric Google Ads customer ID — select an advertising account via discovery.`);
  const login = normalizeGadsCustomerId(opts.loginCustomerId ?? creds.managerId) ?? "";

  const rows: any[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await gadsFetch(`${GADS_BASE}/customers/${cid}/googleAds:search`, {
      method: "POST",
      headers: {
        Authorization:     `Bearer ${token}`,
        "developer-token": creds.developerToken,
        "Content-Type":    "application/json",
        ...(login ? { "login-customer-id": login } : {}),
      },
      body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(friendlyApiError(res.status, body));
    }
    const json = await res.json() as any;
    rows.push(...(json.results ?? []));
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  return rows;
}

// ── Account discovery ─────────────────────────────────────────────────────────

export interface DiscoveredCustomer {
  customerId:      string;
  descriptiveName: string | null;
  currencyCode:    string | null;
  timeZone:        string | null;
  isManager:       boolean;
  /** Manager id to use as login-customer-id when accessing this account. */
  loginCustomerId: string | null;
  status:          string | null;
}

/** listAccessibleCustomers + customer_client expansion for manager accounts. */
export async function discoverAccessibleCustomers(workspaceId: string): Promise<DiscoveredCustomer[]> {
  const creds = await loadGadsCreds(workspaceId);
  if (!creds.developerToken) throw new Error("GADS_NO_DEV_TOKEN: Google Ads developer token missing in provider settings");
  const token = await getGadsAccessToken(workspaceId, creds);

  const res = await gadsFetch(`${GADS_BASE}/customers:listAccessibleCustomers`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "developer-token": creds.developerToken },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(friendlyApiError(res.status, body));
  }
  const json = await res.json() as any;
  const ids: string[] = (json.resourceNames ?? []).map((rn: string) => rn.replace("customers/", ""));
  if (ids.length === 0) return [];

  const found = new Map<string, DiscoveredCustomer>();
  for (const id of ids.slice(0, 25)) {
    try {
      const rows = await gaqlSearch({ workspaceId, customerId: id, loginCustomerId: id, creds }, `
        SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager,
               customer_client.currency_code, customer_client.time_zone, customer_client.status,
               customer_client.level
        FROM customer_client
        WHERE customer_client.level <= 5
      `.trim());
      for (const r of rows) {
        const cc = r.customerClient ?? {};
        const cid = String(cc.id ?? "");
        if (!cid) continue;
        const isSelf = cid === id;
        const entry: DiscoveredCustomer = {
          customerId:      cid,
          descriptiveName: cc.descriptiveName ?? null,
          currencyCode:    cc.currencyCode ?? null,
          timeZone:        cc.timeZone ?? null,
          isManager:       !!cc.manager,
          loginCustomerId: isSelf ? null : id,
          status:          cc.status ?? null,
        };
        // Prefer direct (non-manager-path) entries when duplicated
        const prev = found.get(cid);
        if (!prev || (prev.loginCustomerId && !entry.loginCustomerId)) found.set(cid, entry);
      }
    } catch {
      // A directly-accessible id may itself be queryable even if expansion fails
      if (!found.has(id)) {
        found.set(id, {
          customerId: id, descriptiveName: null, currencyCode: null,
          timeZone: null, isManager: false, loginCustomerId: null, status: null,
        });
      }
    }
  }
  return Array.from(found.values());
}

// ── Connection state derivation (honest, 4-stage) ─────────────────────────────

export interface GadsConnectionState {
  oauthConnected:  boolean;
  apiVerified:     boolean;
  accountSelected: boolean;
  syncHealthy:     boolean;
  stateLabel:      "not_connected" | "oauth_connected" | "api_verified" | "account_selected" | "sync_healthy" | "needs_reconnect" | "sync_failed";
  detail:          string;
}

export async function deriveConnectionState(workspaceId: string, accountRow: any | null): Promise<GadsConnectionState> {
  const creds = await loadGadsCreds(workspaceId);
  const oauthConnected = !!(creds.refreshToken && creds.clientId && creds.clientSecret);
  if (!oauthConnected) {
    return {
      oauthConnected: false, apiVerified: false, accountSelected: false, syncHealthy: false,
      stateLabel: "not_connected",
      detail: !creds.clientId || !creds.clientSecret
        ? "OAuth Client ID/Secret missing — add them in provider settings, then Connect with Google."
        : "Google sign-in not completed — click Connect with Google to grant access.",
    };
  }

  // API verified = we can list accessible customers (cheap call, no GAQL)
  let apiVerified = false;
  let apiDetail = "";
  try {
    const token = await getGadsAccessToken(workspaceId, creds);
    const res = await gadsFetch(`${GADS_BASE}/customers:listAccessibleCustomers`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, "developer-token": creds.developerToken ?? "" },
    });
    if (res.ok) apiVerified = true;
    else apiDetail = friendlyApiError(res.status, await res.text().catch(() => ""));
  } catch (e: any) {
    apiDetail = e?.message ?? "API verification failed";
  }
  if (!apiVerified) {
    const revoked = apiDetail.includes("revoked") || apiDetail.includes("GADS_TOKEN_REVOKED");
    return {
      oauthConnected: true, apiVerified: false, accountSelected: false, syncHealthy: false,
      stateLabel: revoked ? "needs_reconnect" : "oauth_connected",
      detail: apiDetail,
    };
  }

  const accountSelected = !!accountRow?.customer_id;
  if (!accountSelected) {
    return {
      oauthConnected: true, apiVerified: true, accountSelected: false, syncHealthy: false,
      stateLabel: "api_verified",
      detail: "Google access verified — select your advertising account to start syncing.",
    };
  }

  // Sync healthy = last run succeeded within the active refresh window
  const sb = admin();
  const { data: lastRun } = await sb
    .from("growthmind_gads_sync_runs")
    .select("status, finished_at, error_message")
    .eq("workspace_id", workspaceId)
    .eq("account_row_id", accountRow.id)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastRun) {
    return {
      oauthConnected: true, apiVerified: true, accountSelected: true, syncHealthy: false,
      stateLabel: "account_selected",
      detail: "Account selected — first sync has not run yet.",
    };
  }
  const ageMin = lastRun.finished_at ? (Date.now() - new Date(lastRun.finished_at).getTime()) / 60_000 : null;
  const healthy = lastRun.status === "success" && ageMin !== null && ageMin < 60;
  return {
    oauthConnected: true, apiVerified: true, accountSelected: true, syncHealthy: healthy,
    stateLabel: healthy ? "sync_healthy" : lastRun.status === "error" ? "sync_failed" : "account_selected",
    detail: healthy
      ? `Last sync succeeded ${Math.round(ageMin!)} min ago.`
      : lastRun.status === "error"
        ? `Last sync failed: ${(lastRun.error_message ?? "unknown error").slice(0, 200)}`
        : lastRun.finished_at ? `Last successful sync ${Math.round(ageMin ?? 0)} min ago (stale).` : "Sync in progress…",
  };
}

// ── Sync engine ───────────────────────────────────────────────────────────────

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function daysAgo(n: number): string { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d); }

export interface GadsSyncResult {
  ok:        boolean;
  status:    "success" | "partial" | "error" | "skipped";
  campaigns: number;
  rows:      number;
  spend:     number;
  error?:    string;
  runId?:    string;
}

/**
 * Full incremental sync for one google account row.
 * runType: initial (90d), incremental (3d), historical (35d), manual (30d).
 */
export async function runGadsSync(
  workspaceId: string,
  accountRowId: string,
  runType: "initial" | "incremental" | "historical" | "manual" = "incremental",
): Promise<GadsSyncResult> {
  const sb = admin();

  const { data: acc } = await sb
    .from("growthmind_ads_accounts")
    .select("id, workspace_id, platform, customer_id, login_customer_id, status, connection_state")
    .eq("id", accountRowId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!acc || acc.platform !== "google") return { ok: false, status: "skipped", campaigns: 0, rows: 0, spend: 0, error: "Google account row not found" };
  if (!acc.customer_id) return { ok: false, status: "skipped", campaigns: 0, rows: 0, spend: 0, error: "No advertising account selected yet" };
  if (acc.status === "disconnected") return { ok: false, status: "skipped", campaigns: 0, rows: 0, spend: 0, error: "Account disconnected" };
  // Never continuously retry an invalid/revoked refresh token from the scheduler.
  // Manual "Sync Now" (and initial/historical runs after reconnect) may still try.
  if (acc.connection_state === "needs_reconnect" && runType === "incremental") {
    return { ok: false, status: "skipped", campaigns: 0, rows: 0, spend: 0, error: "Reconnection required — Google access was revoked. Scheduled sync paused until reconnected." };
  }

  // Overlap prevention: skip if a run is already in-flight (started < 10 min ago)
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: running } = await sb
    .from("growthmind_gads_sync_runs")
    .select("id")
    .eq("account_row_id", accountRowId)
    .eq("status", "running")
    .gte("started_at", cutoff)
    .limit(1);
  if (running && running.length > 0) {
    return { ok: false, status: "skipped", campaigns: 0, rows: 0, spend: 0, error: "A sync is already running" };
  }

  const { data: run } = await sb
    .from("growthmind_gads_sync_runs")
    .insert({ workspace_id: workspaceId, account_row_id: accountRowId, run_type: runType, status: "running" })
    .select("id")
    .single();
  const runId = run?.id as string | undefined;

  const windowDays = runType === "initial" ? 90 : runType === "historical" ? 35 : runType === "manual" ? 30 : 3;
  const since = daysAgo(windowDays);
  const until = isoDate(new Date());
  const gaqlOpts: GaqlOptions = { workspaceId, customerId: acc.customer_id, loginCustomerId: acc.login_customer_id };

  const now = new Date().toISOString();
  let campaignsSynced = 0;
  let rowsUpserted = 0;
  let spendSynced = 0;
  const sectionErrors: string[] = [];

  // ── 1. Campaign daily metrics (core; failure = whole run error) ─────────────
  try {
    const rows = await gaqlSearch(gaqlOpts, `
      SELECT campaign.id, campaign.name, campaign.status,
             campaign.advertising_channel_type, campaign_budget.amount_micros,
             metrics.cost_micros, metrics.impressions, metrics.clicks,
             metrics.conversions, metrics.conversions_value, segments.date
      FROM campaign
      WHERE segments.date BETWEEN '${since}' AND '${until}'
        AND campaign.status != 'REMOVED'
    `.trim());

    const campaignIds = new Set<string>();
    const upserts = rows.map((r: any) => {
      const camp = r.campaign ?? {};
      const m = r.metrics ?? {};
      const id = String(camp.id ?? "");
      campaignIds.add(id);
      const cost = Number(m.costMicros ?? 0);
      spendSynced += cost / 1_000_000;
      return {
        workspace_id:      workspaceId,
        account_row_id:    accountRowId,
        customer_id:       acc.customer_id,
        campaign_id:       id,
        date:              r.segments?.date ?? until,
        name:              camp.name ?? id,
        status:            String(camp.status ?? "").toLowerCase() || null,
        channel_type:      camp.advertisingChannelType ?? null,
        budget_micros:     r.campaignBudget?.amountMicros != null ? Number(r.campaignBudget.amountMicros) : null,
        cost_micros:       cost,
        impressions:       Number(m.impressions ?? 0),
        clicks:            Number(m.clicks ?? 0),
        conversions:       Number(m.conversions ?? 0),
        conversions_value: Number(m.conversionsValue ?? 0),
        updated_at:        now,
      };
    }).filter((u: any) => u.campaign_id);

    // Batch upserts (500 per request)
    for (let i = 0; i < upserts.length; i += 500) {
      const { error } = await sb
        .from("growthmind_gads_campaign_daily")
        .upsert(upserts.slice(i, i + 500), { onConflict: "workspace_id,customer_id,campaign_id,date" });
      if (error) throw new Error(`campaign_daily upsert: ${error.message}`);
      rowsUpserted += Math.min(500, upserts.length - i);
    }
    campaignsSynced = campaignIds.size;
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (runId) await sb.from("growthmind_gads_sync_runs").update({
      status: "error", finished_at: new Date().toISOString(), error_message: msg.slice(0, 500),
    }).eq("id", runId);
    const revoked = msg.includes("GADS_TOKEN_REVOKED") || msg.toLowerCase().includes("revoked");
    await sb.from("growthmind_ads_accounts").update({
      sync_status: "error", sync_error: msg.slice(0, 500),
      connection_state: revoked ? "needs_reconnect" : "sync_failed", updated_at: now,
    }).eq("id", accountRowId);
    await sb.from("growthmind_ad_sync_log").insert({
      workspace_id: workspaceId, account_id: accountRowId, platform: "google",
      status: "error", campaigns_synced: 0, spend_total: 0, error_message: msg.slice(0, 500),
    }).then(() => {}, () => {});
    return { ok: false, status: "error", campaigns: 0, rows: 0, spend: 0, error: msg, runId };
  }

  // ── 2. Supporting entities (fault-isolated; failures → partial) ─────────────
  const dimSince = daysAgo(30);
  const entityQueries: Array<{ type: string; query: string; map: (r: any) => { key: string; label: string; campaignId: string; meta?: any } | null }> = [
    {
      type: "ad_group",
      query: `SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id,
                     metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
              FROM ad_group WHERE segments.date BETWEEN '${dimSince}' AND '${until}' AND ad_group.status != 'REMOVED'`,
      map: r => r.adGroup?.id ? { key: String(r.adGroup.id), label: r.adGroup.name ?? String(r.adGroup.id), campaignId: String(r.campaign?.id ?? ""), meta: { status: r.adGroup.status } } : null,
    },
    {
      type: "keyword",
      query: `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, campaign.id,
                     metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
              FROM keyword_view WHERE segments.date BETWEEN '${dimSince}' AND '${until}'`,
      map: r => r.adGroupCriterion?.criterionId ? { key: String(r.adGroupCriterion.criterionId), label: r.adGroupCriterion.keyword?.text ?? "", campaignId: String(r.campaign?.id ?? ""), meta: { matchType: r.adGroupCriterion.keyword?.matchType } } : null,
    },
    {
      type: "search_term",
      query: `SELECT search_term_view.search_term, campaign.id,
                     metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
              FROM search_term_view WHERE segments.date BETWEEN '${dimSince}' AND '${until}'`,
      map: r => r.searchTermView?.searchTerm ? { key: String(r.searchTermView.searchTerm).slice(0, 300), label: String(r.searchTermView.searchTerm).slice(0, 300), campaignId: String(r.campaign?.id ?? "") } : null,
    },
    {
      type: "device",
      query: `SELECT campaign.id, segments.device,
                     metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
              FROM campaign WHERE segments.date BETWEEN '${dimSince}' AND '${until}' AND campaign.status != 'REMOVED'`,
      map: r => r.segments?.device ? { key: String(r.segments.device), label: String(r.segments.device), campaignId: String(r.campaign?.id ?? "") } : null,
    },
    {
      type: "location",
      query: `SELECT campaign.id, geographic_view.country_criterion_id, geographic_view.location_type,
                     metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
              FROM geographic_view WHERE segments.date BETWEEN '${dimSince}' AND '${until}'`,
      map: r => r.geographicView?.countryCriterionId ? { key: String(r.geographicView.countryCriterionId), label: `geo:${r.geographicView.countryCriterionId}`, campaignId: String(r.campaign?.id ?? "") } : null,
    },
  ];

  for (const eq of entityQueries) {
    try {
      const rows = await gaqlSearch(gaqlOpts, eq.query.trim());
      // Aggregate over the window per entity+campaign
      const agg = new Map<string, any>();
      for (const r of rows) {
        const mapped = eq.map(r);
        if (!mapped || !mapped.campaignId) continue;
        const m = r.metrics ?? {};
        const k = `${mapped.campaignId}|${mapped.key}`;
        const prev = agg.get(k) ?? {
          workspace_id: workspaceId, account_row_id: accountRowId, customer_id: acc.customer_id,
          campaign_id: mapped.campaignId, entity_type: eq.type, entity_key: mapped.key,
          label: mapped.label, date_start: dimSince, date_end: until,
          cost_micros: 0, impressions: 0, clicks: 0, conversions: 0, conversions_value: 0,
          meta: mapped.meta ?? null, updated_at: now,
        };
        prev.cost_micros       += Number(m.costMicros ?? 0);
        prev.impressions       += Number(m.impressions ?? 0);
        prev.clicks            += Number(m.clicks ?? 0);
        prev.conversions       += Number(m.conversions ?? 0);
        prev.conversions_value += Number(m.conversionsValue ?? 0);
        agg.set(k, prev);
      }
      const list = Array.from(agg.values());
      for (let i = 0; i < list.length; i += 500) {
        const { error } = await sb
          .from("growthmind_gads_dimension_stats")
          .upsert(list.slice(i, i + 500), { onConflict: "workspace_id,customer_id,campaign_id,entity_type,entity_key,date_start" });
        if (error) throw new Error(error.message);
        rowsUpserted += Math.min(500, list.length - i);
      }
    } catch (err: any) {
      sectionErrors.push(`${eq.type}: ${(err?.message ?? String(err)).slice(0, 160)}`);
    }
  }

  // ── 3. Refresh legacy growthmind_campaigns aggregates (30-day window) ───────
  // Keeps the existing page/AccountsMind/HiveMind consumers working unchanged.
  try {
    const aggSince = daysAgo(30);
    const { data: dailies } = await sb
      .from("growthmind_gads_campaign_daily")
      .select("campaign_id, name, status, cost_micros, impressions, clicks, conversions, conversions_value")
      .eq("workspace_id", workspaceId)
      .eq("account_row_id", accountRowId)
      .gte("date", aggSince)
      .limit(10000);
    const byId = new Map<string, any>();
    for (const d of dailies ?? []) {
      const prev = byId.get(d.campaign_id) ?? {
        workspace_id: workspaceId, ads_account_id: accountRowId, platform: "google",
        external_id: d.campaign_id, name: d.name,
        status: d.status === "enabled" ? "active" : d.status === "paused" ? "paused" : "ended",
        spend: 0, impressions: 0, clicks: 0, conversions: 0, roas: null,
        period_start: aggSince, period_end: until, updated_at: now,
        _value: 0,
      };
      prev.spend       += Number(d.cost_micros ?? 0) / 1_000_000;
      prev.impressions += Number(d.impressions ?? 0);
      prev.clicks      += Number(d.clicks ?? 0);
      prev.conversions += Number(d.conversions ?? 0);
      prev._value      += Number(d.conversions_value ?? 0);
      prev.name         = d.name;
      byId.set(d.campaign_id, prev);
    }
    for (const c of byId.values()) {
      const { _value, ...row } = c;
      row.roas = row.spend > 0 && _value > 0 ? +(_value / row.spend).toFixed(3) : null;
      row.conversions = Math.round(row.conversions);
      await sb.from("growthmind_campaigns")
        .upsert({ ...row, created_at: now }, { onConflict: "ads_account_id,external_id" })
        .then(() => {}, () => {});
    }
  } catch { /* legacy mirror is best-effort */ }

  // ── 4. Finalise run + account status ────────────────────────────────────────
  const finishedAt = new Date().toISOString();
  const status: "success" | "partial" = sectionErrors.length > 0 ? "partial" : "success";
  if (runId) await sb.from("growthmind_gads_sync_runs").update({
    status, finished_at: finishedAt,
    campaigns_synced: campaignsSynced, rows_upserted: rowsUpserted, spend_synced: +spendSynced.toFixed(2),
    error_message: sectionErrors.length ? sectionErrors.join(" | ").slice(0, 800) : null,
    stats: { windowDays, sectionErrors },
  }).eq("id", runId);

  await sb.from("growthmind_ads_accounts").update({
    sync_status: "synced", sync_error: sectionErrors.length ? sectionErrors.join(" | ").slice(0, 500) : null,
    last_synced_at: finishedAt, total_spend_synced: +spendSynced.toFixed(2),
    connection_state: "sync_healthy", updated_at: finishedAt,
  }).eq("id", accountRowId);

  await sb.from("growthmind_ad_sync_log").insert({
    workspace_id: workspaceId, account_id: accountRowId, platform: "google",
    status, campaigns_synced: campaignsSynced, spend_total: +spendSynced.toFixed(2),
    error_message: sectionErrors.length ? sectionErrors.join(" | ").slice(0, 500) : null,
  }).then(() => {}, () => {});

  // ── 5. Post-sync analysis (best-effort) ─────────────────────────────────────
  try { await runGadsAnalysis(workspaceId, accountRowId); } catch { /* non-fatal */ }

  return { ok: true, status, campaigns: campaignsSynced, rows: rowsUpserted, spend: +spendSynced.toFixed(2), runId };
}

// ── Deterministic analysis → approval-gated recommendations ──────────────────

export interface RecDraft {
  section:  "immediate_attention" | "wasted_spend" | "budget_opportunity" | "growth" | "conversion" | "tracking_quality";
  priority: "critical" | "high" | "medium" | "low";
  confidence: number;
  title: string;
  campaign_id: string | null;
  campaign_name: string | null;
  evidence: any;
  expected_benefit: string;
  recommended_action: string;
  dedupe_key: string;
}

// ── Recommendation quality gate ──────────────────────────────────────────────
// A recommendation must reference a specific entity, carry measurable evidence
// (>= 2 numeric metrics), a specific action and a confidence score. Vague
// "optimise your campaign" advice fails validation and is never stored.
const VAGUE_PHRASES = [
  "improve targeting", "optimise your campaign", "optimize your campaign",
  "consider changing your budget", "try different keywords", "improve your landing page",
  "test new ads", "monitor performance", "increase engagement",
];

export function validateRecDraft(r: RecDraft): boolean {
  if (!r.title || !r.recommended_action || !r.dedupe_key) return false;
  if (typeof r.confidence !== "number" || !Number.isFinite(r.confidence) || r.confidence <= 0 || r.confidence > 1) return false;
  // Specific entity: a campaign, a keyword/search-term, or an explicit account-level check
  const acctLevel = r.dedupe_key.includes(":acct:");
  if (!acctLevel && !r.campaign_id) return false;
  // Measurable evidence: at least 2 numeric metrics
  const numericMetrics = Object.values(r.evidence ?? {}).filter(v => typeof v === "number" && Number.isFinite(v));
  if (numericMetrics.length < 2) return false;
  // Action must be specific (length + not a bare vague phrase)
  const action = r.recommended_action.trim().toLowerCase();
  if (action.length < 25) return false;
  if (VAGUE_PHRASES.some(p => action === p || action === `${p}.`)) return false;
  return true;
}

/**
 * Deterministic lead→campaign attribution. A lead is assigned to at most ONE
 * campaign: exact normalized utm_campaign match wins; otherwise a containment
 * match is used only when it is unambiguous (exactly one candidate campaign).
 * Leads without a resolvable single campaign are left unattributed.
 */
export function attributePaidLeadsToCampaigns(
  paidLeads: Array<{ id: string; utm_campaign?: string | null }>,
  campaigns: Array<{ id: string; name: string }>,
): Map<string, any[]> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const byExact = new Map<string, string[]>();
  for (const c of campaigns) {
    const k = norm(c.name);
    if (!k) continue;
    byExact.set(k, [...(byExact.get(k) ?? []), c.id]);
  }
  const out = new Map<string, any[]>();
  for (const l of paidLeads) {
    const u = norm(String(l.utm_campaign ?? ""));
    if (!u) continue;
    // Exact match (must be unique among campaigns too)
    const exact = byExact.get(u);
    let target: string | null = exact && exact.length === 1 ? exact[0] : null;
    if (!target && u.length >= 4) {
      // Containment either direction, accepted only if exactly one campaign matches
      const matches = campaigns.filter(c => {
        const n = norm(c.name);
        return n.length >= 4 && (n.includes(u) || u.includes(n));
      });
      if (matches.length === 1) target = matches[0].id;
    }
    if (target) out.set(target, [...(out.get(target) ?? []), l]);
  }
  return out;
}

/** Cap active output: max 3 critical, 5 high, 10 total (per account, per run). */
export function capRecDrafts(recs: RecDraft[]): RecDraft[] {
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...recs].sort((a, b) => (order[a.priority] - order[b.priority]) || (b.confidence - a.confidence));
  const out: RecDraft[] = [];
  let crit = 0, high = 0;
  for (const r of sorted) {
    if (out.length >= 10) break;
    if (r.priority === "critical") { if (crit >= 3) continue; crit++; }
    if (r.priority === "high")     { if (high >= 5) continue; high++; }
    out.push(r);
  }
  return out;
}

export async function runGadsAnalysis(workspaceId: string, accountRowId: string): Promise<{ generated: number }> {
  const sb = admin();
  const since30 = daysAgo(30);
  const prev60  = daysAgo(60);
  const now = new Date().toISOString();

  const { data: acc } = await sb.from("growthmind_ads_accounts")
    .select("id, customer_id, currency_code").eq("id", accountRowId).eq("workspace_id", workspaceId).maybeSingle();
  if (!acc?.customer_id) return { generated: 0 };
  const cur = acc.currency_code === "USD" ? "$" : acc.currency_code === "EUR" ? "€" : "£";

  const { data: dailies } = await sb
    .from("growthmind_gads_campaign_daily")
    .select("campaign_id, name, status, date, cost_micros, impressions, clicks, conversions, conversions_value, budget_micros")
    .eq("workspace_id", workspaceId)
    .eq("account_row_id", accountRowId)
    .gte("date", prev60)
    .limit(20000);

  const since7  = daysAgo(7);
  const since14 = daysAgo(14);
  interface Agg { name: string; status: string | null; spend: number; impr: number; clicks: number; conv: number; value: number; prevSpend: number; prevConv: number; budget: number | null; spend7: number; spendPrev7: number; conv7: number; convPrev7: number; activeDays30: number }
  const camps = new Map<string, Agg>();
  for (const d of dailies ?? []) {
    const c = camps.get(d.campaign_id) ?? { name: d.name, status: d.status, spend: 0, impr: 0, clicks: 0, conv: 0, value: 0, prevSpend: 0, prevConv: 0, budget: null, spend7: 0, spendPrev7: 0, conv7: 0, convPrev7: 0, activeDays30: 0 };
    const spend = Number(d.cost_micros ?? 0) / 1_000_000;
    if (d.date >= since30) {
      c.spend += spend; c.impr += Number(d.impressions ?? 0); c.clicks += Number(d.clicks ?? 0);
      c.conv += Number(d.conversions ?? 0); c.value += Number(d.conversions_value ?? 0);
      c.name = d.name; c.status = d.status;
      if (d.budget_micros != null) c.budget = Number(d.budget_micros) / 1_000_000;
      if (spend > 0 || Number(d.impressions ?? 0) > 0) c.activeDays30++;
    } else {
      c.prevSpend += spend; c.prevConv += Number(d.conversions ?? 0);
    }
    if (d.date >= since7) { c.spend7 += spend; c.conv7 += Number(d.conversions ?? 0); }
    else if (d.date >= since14) { c.spendPrev7 += spend; c.convPrev7 += Number(d.conversions ?? 0); }
    camps.set(d.campaign_id, c);
  }

  const active = Array.from(camps.entries()).filter(([, c]) => c.status === "enabled" || c.spend > 0);
  const totSpend = active.reduce((s, [, c]) => s + c.spend, 0);
  const totConv  = active.reduce((s, [, c]) => s + c.conv, 0);
  const totClicks = active.reduce((s, [, c]) => s + c.clicks, 0);
  const acctCpa = totConv > 0 ? totSpend / totConv : null;

  const recs: RecDraft[] = [];

  for (const [id, c] of active) {
    const ctr = c.impr > 0 ? c.clicks / c.impr : 0;
    const cpa = c.conv > 0 ? c.spend / c.conv : null;
    const roas = c.spend > 0 && c.value > 0 ? c.value / c.spend : null;

    // Immediate attention: meaningful spend, zero conversions
    if (c.spend >= 50 && c.conv === 0 && c.clicks >= 20) {
      recs.push({
        section: "immediate_attention", priority: "critical", confidence: 0.85,
        title: `"${c.name}" spent ${cur}${c.spend.toFixed(0)} in 30 days with zero conversions`,
        campaign_id: id, campaign_name: c.name,
        evidence: { spend30d: +c.spend.toFixed(2), clicks30d: c.clicks, conversions30d: 0, ctr: +(ctr * 100).toFixed(2) },
        expected_benefit: `Stop up to ${cur}${c.spend.toFixed(0)}/month of unconverting spend`,
        recommended_action: `Pause or restructure "${c.name}": review landing page, conversion tracking and search terms before re-enabling.`,
        dedupe_key: `gads:${acc.customer_id}:${id}:zero_conv`,
      });
    }

    // Conversion efficiency: CPA far above account average
    if (cpa !== null && acctCpa !== null && active.length > 1 && cpa > acctCpa * 1.5 && c.spend >= 30) {
      recs.push({
        section: "conversion", priority: "high", confidence: 0.75,
        title: `"${c.name}" CPA ${cur}${cpa.toFixed(0)} is ${Math.round((cpa / acctCpa - 1) * 100)}% above account average`,
        campaign_id: id, campaign_name: c.name,
        evidence: { cpa: +cpa.toFixed(2), accountAvgCpa: +acctCpa.toFixed(2), spend30d: +c.spend.toFixed(2), conversions30d: +c.conv.toFixed(1) },
        expected_benefit: `Bringing CPA to account average would save ~${cur}${((cpa - acctCpa) * c.conv).toFixed(0)}/month`,
        recommended_action: `Tighten targeting and negative keywords on "${c.name}", or shift budget to lower-CPA campaigns.`,
        dedupe_key: `gads:${acc.customer_id}:${id}:high_cpa`,
      });
    }

    // Budget opportunity / growth: strong ROAS with stable spend
    if (roas !== null && roas >= 3 && c.spend >= 30) {
      recs.push({
        section: "budget_opportunity", priority: "medium", confidence: 0.7,
        title: `"${c.name}" is returning ${roas.toFixed(1)}x ROAS — headroom to scale`,
        campaign_id: id, campaign_name: c.name,
        evidence: { roas: +roas.toFixed(2), spend30d: +c.spend.toFixed(2), conversionsValue30d: +c.value.toFixed(2), dailyBudget: c.budget },
        expected_benefit: `A 20% budget increase could add ~${cur}${(c.value * 0.2).toFixed(0)}/month in conversion value at current efficiency`,
        recommended_action: `Increase "${c.name}" daily budget by ~20% and monitor ROAS over the next 2 weeks.`,
        dedupe_key: `gads:${acc.customer_id}:${id}:scale_roas`,
      });
    }

    // Spend spike: last 7 days vs the 7 days before, with a meaningful base
    if (c.spendPrev7 >= 20 && c.spend7 >= c.spendPrev7 * 1.6 && c.spend7 - c.spendPrev7 >= 20) {
      const convHeldUp = c.convPrev7 > 0 ? c.conv7 >= c.convPrev7 : c.conv7 > 0;
      recs.push({
        section: convHeldUp ? "growth" : "immediate_attention",
        priority: convHeldUp ? "medium" : "high",
        confidence: 0.7,
        title: `"${c.name}" spend jumped ${Math.round((c.spend7 / c.spendPrev7 - 1) * 100)}% week-on-week${convHeldUp ? "" : " without more conversions"}`,
        campaign_id: id, campaign_name: c.name,
        evidence: { spendLast7d: +c.spend7.toFixed(2), spendPrev7d: +c.spendPrev7.toFixed(2), conversionsLast7d: +c.conv7.toFixed(1), conversionsPrev7d: +c.convPrev7.toFixed(1) },
        expected_benefit: convHeldUp
          ? "Confirms scaling is holding efficiency — worth continuing deliberately"
          : `Contain up to ${cur}${(c.spend7 - c.spendPrev7).toFixed(0)}/week of unplanned spend growth`,
        recommended_action: convHeldUp
          ? `Spend on "${c.name}" rose to ${cur}${c.spend7.toFixed(0)}/week and conversions kept pace — verify the increase was intentional and set a budget ceiling.`
          : `Review "${c.name}" bidding and recent search terms: weekly spend rose to ${cur}${c.spend7.toFixed(0)} while conversions did not increase. Cap the daily budget until efficiency recovers.`,
        dedupe_key: `gads:${acc.customer_id}:${id}:spend_spike`,
      });
    }

    // Strong campaign limited by budget: spend near the 30-day budget ceiling with good return
    if (c.budget != null && c.budget > 0 && c.activeDays30 >= 7) {
      const ceiling = c.budget * c.activeDays30;
      if (ceiling > 0 && c.spend >= ceiling * 0.9 && roas !== null && roas >= 2) {
        recs.push({
          section: "budget_opportunity", priority: "high", confidence: 0.75,
          title: `"${c.name}" is spending ${Math.round((c.spend / ceiling) * 100)}% of its budget ceiling at ${roas.toFixed(1)}x ROAS`,
          campaign_id: id, campaign_name: c.name,
          evidence: { spend30d: +c.spend.toFixed(2), budgetCeiling30d: +ceiling.toFixed(2), dailyBudget: +c.budget.toFixed(2), roas: +roas.toFixed(2), activeDays30: c.activeDays30 },
          expected_benefit: `Budget is capping a campaign returning ${cur}${roas.toFixed(1)} per ${cur}1 — raising it should add conversion value at similar efficiency`,
          recommended_action: `"${c.name}" is budget-limited: raise the daily budget from ${cur}${c.budget.toFixed(0)} in ~20% steps and watch ROAS weekly.`,
          dedupe_key: `gads:${acc.customer_id}:${id}:budget_limited`,
        });
      }

      // Under-delivery: enabled with a real budget but barely spending
      if (c.status === "enabled" && c.activeDays30 >= 7 && ceiling >= 50 && c.spend < ceiling * 0.2 && c.impr < 500) {
        recs.push({
          section: "immediate_attention", priority: "medium", confidence: 0.65,
          title: `"${c.name}" is only spending ${Math.round((c.spend / ceiling) * 100)}% of its available budget`,
          campaign_id: id, campaign_name: c.name,
          evidence: { spend30d: +c.spend.toFixed(2), budgetCeiling30d: +ceiling.toFixed(2), impressions30d: c.impr, activeDays30: c.activeDays30 },
          expected_benefit: "An enabled campaign that cannot spend is usually blocked by bids, targeting, or ad approval — fixing it unlocks paid volume you already budgeted for",
          recommended_action: `Check "${c.name}" for disapproved ads, overly narrow targeting or bids below the auction floor — it served only ${c.impr} impressions in 30 days against a ${cur}${ceiling.toFixed(0)} budget ceiling.`,
          dedupe_key: `gads:${acc.customer_id}:${id}:under_delivery`,
        });
      }
    }

    // Growth: conversions trending up strongly vs previous 30 days
    if (c.prevConv > 0 && c.conv >= c.prevConv * 1.5 && c.conv >= 5) {
      recs.push({
        section: "growth", priority: "medium", confidence: 0.65,
        title: `"${c.name}" conversions up ${Math.round((c.conv / c.prevConv - 1) * 100)}% vs the prior 30 days`,
        campaign_id: id, campaign_name: c.name,
        evidence: { conversions30d: +c.conv.toFixed(1), conversionsPrev30d: +c.prevConv.toFixed(1), spend30d: +c.spend.toFixed(2) },
        expected_benefit: "Compounding a working campaign is the cheapest growth available",
        recommended_action: `Expand "${c.name}" with additional ad variants and close-variant keywords while momentum holds.`,
        dedupe_key: `gads:${acc.customer_id}:${id}:conv_up`,
      });
    }
  }

  // Wasted spend: search terms with real cost and zero conversions
  try {
    const { data: terms } = await sb
      .from("growthmind_gads_dimension_stats")
      .select("campaign_id, entity_key, label, cost_micros, clicks, conversions")
      .eq("workspace_id", workspaceId)
      .eq("account_row_id", accountRowId)
      .eq("entity_type", "search_term")
      .order("cost_micros", { ascending: false })
      .limit(200);
    const wasted = (terms ?? []).filter((t: any) => Number(t.cost_micros) / 1e6 >= 10 && Number(t.conversions) === 0).slice(0, 3);
    for (const t of wasted) {
      const cost = Number(t.cost_micros) / 1e6;
      const cName = camps.get(t.campaign_id)?.name ?? t.campaign_id;
      recs.push({
        section: "wasted_spend", priority: "high", confidence: 0.8,
        title: `Search term "${t.label}" cost ${cur}${cost.toFixed(0)} with no conversions`,
        campaign_id: t.campaign_id, campaign_name: cName,
        evidence: { searchTerm: t.label, cost30d: +cost.toFixed(2), clicks30d: Number(t.clicks), conversions30d: 0 },
        expected_benefit: `Save ~${cur}${cost.toFixed(0)}/month by excluding this term`,
        recommended_action: `Add "${t.label}" as a negative keyword in "${cName}".`,
        dedupe_key: `gads:${acc.customer_id}:${t.campaign_id}:negkw:${String(t.entity_key).slice(0, 80)}`,
      });
    }
  } catch { /* dimension stats may be empty */ }

  // Lead-quality loop: connect campaign spend to WEBEE CRM leads (UTM / gclid
  // attribution). Google conversion counts alone can mislead — cross-check what
  // the CRM actually received. Only fires when attribution data exists.
  try {
    const { data: crmLeads } = await sb
      .from("leads")
      .select("id, status, utm_source, utm_medium, utm_campaign, meta, created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
      .or("utm_medium.ilike.%cpc%,utm_medium.ilike.%paid%,utm_medium.ilike.%ppc%,utm_source.ilike.%google%,meta->>gclid.not.is.null,meta->>gclsrc.not.is.null")
      .limit(2000);
    const paidLeads = (crmLeads ?? []).filter((l: any) =>
      String(l.utm_source ?? "").toLowerCase().includes("google") ||
      String(l.utm_medium ?? "").toLowerCase().match(/cpc|paid|ppc/) ||
      (l.meta && typeof l.meta === "object" && (l.meta.gclid || l.meta.gclsrc)));
    if (paidLeads.length >= 5) {
      const qualifiedStatuses = new Set(["interested", "qualified", "sale_done", "completed", "contact_made"]);
      const campaignList = [...active.entries()].map(([cid, c]) => ({ id: cid, name: c.name }));
      const attribution = attributePaidLeadsToCampaigns(paidLeads as any, campaignList);
      for (const [id, c] of active) {
        if (c.spend < 30) continue;
        const cLeads = attribution.get(id) ?? [];
        if (cLeads.length < 5) continue;
        const qualified = cLeads.filter((l: any) => qualifiedStatuses.has(String(l.status)));
        const qualRate = qualified.length / cLeads.length;
        const costPerLead = c.spend / cLeads.length;
        const costPerQualified = qualified.length > 0 ? c.spend / qualified.length : null;
        if (qualRate < 0.15 && c.conv >= 5) {
          recs.push({
            section: "conversion", priority: "high", confidence: 0.7,
            title: `"${c.name}" converts in Google Ads but only ${Math.round(qualRate * 100)}% of its CRM leads qualify`,
            campaign_id: id, campaign_name: c.name,
            evidence: { crmLeads30d: cLeads.length, qualifiedLeads30d: qualified.length, qualifiedRatePct: +(qualRate * 100).toFixed(1), googleConversions30d: +c.conv.toFixed(1), costPerLead: +costPerLead.toFixed(2), spend30d: +c.spend.toFixed(2) },
            expected_benefit: `Shifting this spend toward higher-qualifying traffic could recover most of ${cur}${c.spend.toFixed(0)}/month currently buying unqualified leads`,
            recommended_action: `Google reports ${c.conv.toFixed(0)} conversions for "${c.name}" but the CRM qualified only ${qualified.length} of ${cLeads.length} leads — tighten search terms and audiences toward the queries producing qualified leads, and review lead-form quality.`,
            dedupe_key: `gads:${acc.customer_id}:${id}:low_lead_quality`,
          });
        } else if (qualRate >= 0.3 && costPerQualified !== null) {
          recs.push({
            section: "growth", priority: "medium", confidence: 0.7,
            title: `"${c.name}" produces qualified CRM leads at ${cur}${costPerQualified.toFixed(0)} each`,
            campaign_id: id, campaign_name: c.name,
            evidence: { crmLeads30d: cLeads.length, qualifiedLeads30d: qualified.length, qualifiedRatePct: +(qualRate * 100).toFixed(1), costPerQualifiedLead: +costPerQualified.toFixed(2), spend30d: +c.spend.toFixed(2) },
            expected_benefit: `CRM data confirms real qualified demand — budget here buys qualified pipeline at a known ${cur}${costPerQualified.toFixed(0)}/lead`,
            recommended_action: `"${c.name}" has a ${Math.round(qualRate * 100)}% CRM qualification rate — prioritise it in budget allocation before scaling weaker campaigns.`,
            dedupe_key: `gads:${acc.customer_id}:${id}:strong_lead_quality`,
          });
        }
      }
    }
  } catch { /* leads attribution optional */ }

  // Tracking quality: clicks but zero conversions account-wide
  if (totClicks >= 100 && totConv === 0) {
    recs.push({
      section: "tracking_quality", priority: "critical", confidence: 0.9,
      title: "No conversions recorded across the whole account despite significant clicks",
      campaign_id: null, campaign_name: null,
      evidence: { clicks30d: totClicks, conversions30d: 0, spend30d: +totSpend.toFixed(2) },
      expected_benefit: "Restoring conversion tracking makes every other optimisation possible",
      recommended_action: "Verify the Google Ads conversion tag / GA4 import is firing — zero conversions with this much traffic usually means broken tracking.",
      dedupe_key: `gads:${acc.customer_id}:acct:tracking_zero`,
    });
  }

  // Quality gate + volume caps: drop anything vague / evidence-free, then keep
  // at most 3 critical, 5 high, 10 total active recommendations per account.
  const finalRecs = capRecDrafts(recs.filter(validateRecDraft));

  // Upsert by dedupe_key (update evidence on refresh, keep review status)
  let generated = 0;
  const freshKeys = new Set(finalRecs.map(r => r.dedupe_key));
  const freshCritical: RecDraft[] = [];
  for (const r of finalRecs) {
    const { data: existing } = await sb
      .from("growthmind_gads_recommendations")
      .select("id, status")
      .eq("workspace_id", workspaceId)
      .eq("dedupe_key", r.dedupe_key)
      .maybeSingle();
    if (existing) {
      const patch: any = { evidence: r.evidence, title: r.title, expected_benefit: r.expected_benefit, recommended_action: r.recommended_action, priority: r.priority, confidence: r.confidence, updated_at: now };
      if (existing.status === "expired") patch.status = "new";
      await sb.from("growthmind_gads_recommendations").update(patch).eq("id", existing.id);
    } else {
      const { error } = await sb.from("growthmind_gads_recommendations").insert({
        workspace_id: workspaceId, account_row_id: accountRowId, customer_id: acc.customer_id,
        campaign_id: r.campaign_id, campaign_name: r.campaign_name,
        section: r.section, priority: r.priority, confidence: r.confidence,
        title: r.title, evidence: r.evidence, expected_benefit: r.expected_benefit,
        recommended_action: r.recommended_action, status: "new", dedupe_key: r.dedupe_key,
        expires_at: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
      });
      if (!error) {
        generated++;
        if (r.priority === "critical") freshCritical.push(r);
        // Executive event stream — one event per finding lifecycle (the
        // dedupe_key already guarantees the insert branch runs once).
        try {
          const { publishExecutiveEvent } = await import("../hivemind/executive-events.shared");
          await publishExecutiveEvent(sb, {
            workspaceId,
            eventType: "growthmind_recommendation",
            sourceSystem: "growthmind_gads",
            title: r.title,
            summary: r.recommended_action ?? null,
            severity: r.priority === "critical" ? "warning" : "info",
            entityType: "gads_recommendation",
            entityId: r.dedupe_key,
            dedupKey: `growthmind_recommendation:${r.dedupe_key}`,
            evidence: { section: r.section, priority: r.priority, confidence: r.confidence, campaign: r.campaign_name ?? null },
          });
        } catch { /* best-effort */ }
      }
    }
  }

  // Proactively alert on genuinely NEW critical findings (never on refreshes —
  // the dedupe_key upsert guarantees one alert per finding lifecycle).
  for (const r of freshCritical) {
    try {
      const { emitCampaignNotification } = await import("../notifications/notification-engine.shared");
      await emitCampaignNotification(sb, {
        workspaceId,
        eventKey: "needs_admin_attention",
        campaignName: r.campaign_name ?? "Google Ads account",
        summary: `GrowthMind (Google Ads): ${r.title}`,
        recommendedAction: r.recommended_action,
        severity: "critical",
        metadata: { source: "growthmind_gads", section: r.section, dedupe_key: r.dedupe_key },
      } as any);
    } catch { /* notifications are best-effort */ }
  }

  // Expire stale "new" recommendations no longer produced by analysis
  const { data: stale } = await sb
    .from("growthmind_gads_recommendations")
    .select("id, dedupe_key")
    .eq("workspace_id", workspaceId)
    .eq("account_row_id", accountRowId)
    .eq("status", "new");
  for (const s of stale ?? []) {
    if (s.dedupe_key && !freshKeys.has(s.dedupe_key)) {
      await sb.from("growthmind_gads_recommendations").update({ status: "expired", updated_at: now }).eq("id", s.id);
    }
  }

  return { generated };
}

// ── Tick entry point (called from the 15-min ads sync tick) ───────────────────

/** Sync every selected google account across workspaces. Used by the cron tick. */
export async function tickAllGadsAccounts(): Promise<Array<{ workspaceId: string; accountRowId: string; result: GadsSyncResult }>> {
  const sb = admin();
  const { data: accounts } = await sb
    .from("growthmind_ads_accounts")
    .select("id, workspace_id")
    .eq("platform", "google")
    .eq("status", "active")
    .not("customer_id", "is", null);
  const out: Array<{ workspaceId: string; accountRowId: string; result: GadsSyncResult }> = [];
  for (const acc of accounts ?? []) {
    try {
      const result = await runGadsSync(acc.workspace_id, acc.id, "incremental");
      out.push({ workspaceId: acc.workspace_id, accountRowId: acc.id, result });
    } catch (err: any) {
      out.push({ workspaceId: acc.workspace_id, accountRowId: acc.id, result: { ok: false, status: "error", campaigns: 0, rows: 0, spend: 0, error: err?.message ?? String(err) } });
    }
  }
  return out;
}

// ── Account row lookup ────────────────────────────────────────────────────────
export async function getGoogleAccountRow(workspaceId: string): Promise<any | null> {
  const sb = admin();
  const { data } = await sb
    .from("growthmind_ads_accounts")
    .select("id, workspace_id, label, account_id, status, customer_id, login_customer_id, descriptive_name, currency_code, time_zone, connection_state, accessible_customers, sync_status, sync_error, last_synced_at, total_spend_synced, sync_config")
    .eq("workspace_id", workspaceId)
    .eq("platform", "google")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}
