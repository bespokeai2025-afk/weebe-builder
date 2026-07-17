/**
 * WeeBespoke AI Enterprise — server-side API client.
 *
 * ALL calls to the external API are made here — never from the browser.
 * Tokens are never returned to the client; they live only in the DB and in
 * server-function memory during a request.
 *
 * Base: WEBESPOKE_API_BASE_URL in .env (default https://uat-api.webespokeai.com)
 */

const DEFAULT_API_BASE = "https://uat-api.webespokeai.com";

export function getWebespokeApiBaseUrl(): string {
  const raw =
    process.env.WEBESPOKE_API_BASE_URL?.trim() ||
    (import.meta.env.WEBESPOKE_API_BASE_URL as string | undefined)?.trim();
  return (raw || DEFAULT_API_BASE).replace(/\/$/, "");
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

type GetTokens = () => Promise<{ accessToken: string; refreshToken: string }>;
type SaveToken = (token: string) => Promise<void>;

// ── Low-level fetch ───────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const url = `${getWebespokeApiBaseUrl()}${path}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
    if (res.status === 204) return { ok: true, status: 204, data: null };
    const text = await res.text();
    let data: T | null = null;
    try { data = JSON.parse(text) as T; } catch { /* non-JSON */ }
    return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : text.slice(0, 300) };
  } catch (err: any) {
    return { ok: false, status: 0, data: null, error: err?.message ?? "Network error" };
  }
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// ── Auto-refresh wrapper ──────────────────────────────────────────────────────

/** UAT wraps tokens in `{ result, data: { accessToken, refreshToken } }`. */
export function parseWeeBespokeAuthEnvelope(
  body: unknown,
): { accessToken: string; refreshToken: string; user?: unknown } | null {
  const o = body as Record<string, unknown> | null;
  if (!o) return null;
  const inner =
    o.data && typeof o.data === "object"
      ? (o.data as Record<string, unknown>)
      : o;
  const accessToken =
    (inner.accessToken as string | undefined) ??
    (inner.token as string | undefined) ??
    (inner.access_token as string | undefined) ??
    (inner.jwt as string | undefined) ??
    null;
  if (!accessToken) return null;
  const refreshToken =
    (inner.refreshToken as string | undefined) ??
    (inner.refresh_token as string | undefined) ??
    "";
  return { accessToken, refreshToken, user: inner };
}

function extractToken(d: unknown): string | null {
  return parseWeeBespokeAuthEnvelope(d)?.accessToken ?? null;
}

export async function authenticatedFetch<T>(
  path: string,
  options: RequestInit,
  getTokens: GetTokens,
  saveNewAccessToken: SaveToken,
  reloginFn?: () => Promise<{ accessToken: string } | null>,
): Promise<ApiResponse<T>> {
  const { accessToken, refreshToken } = await getTokens();
  const first = await apiFetch<T>(path, {
    ...options,
    headers: { ...(options.headers ?? {}), ...authHeader(accessToken) },
  });
  if (first.status !== 401) return first;

  // Step 1: try refresh token
  if (refreshToken) {
    const refreshRes = await refreshTokenRequest(refreshToken);
    const newToken = extractToken(refreshRes.data);
    if (refreshRes.ok && newToken) {
      await saveNewAccessToken(newToken);
      return apiFetch<T>(path, {
        ...options,
        headers: { ...(options.headers ?? {}), ...authHeader(newToken) },
      });
    }
  }

  // Step 2: try full relogin if provided
  if (reloginFn) {
    try {
      const fresh = await reloginFn();
      if (fresh?.accessToken) {
        await saveNewAccessToken(fresh.accessToken);
        return apiFetch<T>(path, {
          ...options,
          headers: { ...(options.headers ?? {}), ...authHeader(fresh.accessToken) },
        });
      }
    } catch { /* fall through */ }
  }

  return { ok: false, status: 401, data: null, error: "Token expired — reconnect required" };
}

type Relogin = () => Promise<{ accessToken: string } | null>;

// Shorthand helpers
function aGet<T>(path: string, gt: GetTokens, st: SaveToken, rl?: Relogin) {
  return authenticatedFetch<T>(path, { method: "GET" }, gt, st, rl);
}
function aPost<T>(path: string, body: unknown, gt: GetTokens, st: SaveToken, rl?: Relogin) {
  return authenticatedFetch<T>(path, { method: "POST", body: JSON.stringify(body) }, gt, st, rl);
}
function aPatch<T>(path: string, body: unknown, gt: GetTokens, st: SaveToken, rl?: Relogin) {
  return authenticatedFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) }, gt, st, rl);
}
function aPut<T>(path: string, body: unknown, gt: GetTokens, st: SaveToken) {
  return authenticatedFetch<T>(path, { method: "PUT", body: JSON.stringify(body) }, gt, st);
}
function aDel<T>(path: string, gt: GetTokens, st: SaveToken, body?: unknown, rl?: Relogin) {
  return authenticatedFetch<T>(
    path,
    body ? { method: "DELETE", body: JSON.stringify(body) } : { method: "DELETE" },
    gt, st, rl,
  );
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function loginWithPassword(email: string, password: string) {
  return apiFetch<{ accessToken?: string; token?: string; refreshToken?: string; data?: { accessToken?: string; token?: string } }>(
    "/admin/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
  );
}

export async function requestOtp(email: string) {
  return apiFetch<{ message?: string }>("/admin/auth/request-otp", {
    method: "POST", body: JSON.stringify({ email }),
  });
}

export async function verifyOtp(email: string, otp: string) {
  return apiFetch<{ accessToken?: string; token?: string; refreshToken?: string }>(
    "/admin/auth/verify-otp",
    { method: "POST", body: JSON.stringify({ email, otp }) },
  );
}

export async function refreshTokenRequest(refreshToken: string) {
  return apiFetch<{ accessToken?: string; token?: string }>("/auth/refresh-token", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

type DateRange = { startDate: string; endDate: string };

export const wbahDashboardTotalMinutes = (dr: DateRange, gt: GetTokens, st: SaveToken) =>
  aPost("/dashboard/total-call-minutes", dr, gt, st);

export const wbahDashboardCalls = (dr: DateRange, gt: GetTokens, st: SaveToken) =>
  aPost("/dashboard/number-of-calls", dr, gt, st);

export const wbahDashboardLeads = (dr: DateRange, gt: GetTokens, st: SaveToken) =>
  aPost("/dashboard/leads", dr, gt, st);

export const wbahDashboardPerformance = (dr: DateRange, gt: GetTokens, st: SaveToken) =>
  aPost("/dashboard/call-performance", dr, gt, st);

export const wbahDashboardDrops = (dr: DateRange, gt: GetTokens, st: SaveToken) =>
  aPost("/dashboard/call-drops", dr, gt, st);

// ── People / Call Output Data ─────────────────────────────────────────────────

export const wbahGetAllCallData = (gt: GetTokens, st: SaveToken) =>
  aGet("/call-output-data/get-all-calldata", gt, st);

export const wbahGetAllCallDataPaged = (page: number, gt: GetTokens, st: SaveToken, rl?: Relogin) =>
  aGet<unknown>(`/call-output-data/get-all-calldata?currentPage=${page}`, gt, st, rl);

/** Attempt to fetch all call records in a single request (API must honour the limit param). */
export const wbahGetAllCallDataAll = (gt: GetTokens, st: SaveToken) =>
  aGet<unknown>(`/call-output-data/get-all-calldata?limit=10000`, gt, st);

// ── Page-param discovery variants (used only by the diagnostic probe) ──────────
export const wbahCallsParamTest = (paramName: string, value: number | string, gt: GetTokens, st: SaveToken) =>
  aGet<unknown>(`/call-output-data/get-all-calldata?${paramName}=${value}`, gt, st);
export const wbahCallsPostPage = (body: Record<string, unknown>, gt: GetTokens, st: SaveToken) =>
  aPost<unknown>(`/call-output-data/get-all-calldata`, body, gt, st);
export const wbahLeadsParamTest = (paramName: string, value: number | string, gt: GetTokens, st: SaveToken) =>
  aGet<unknown>(`/call-output-data/get-userCall-lead?${paramName}=${value}`, gt, st);

export const wbahGetCallCount = (gt: GetTokens, st: SaveToken) =>
  aGet("/call-output-data/get-call-count", gt, st);

export const wbahGetUserHistory = (payload: Record<string, unknown>, gt: GetTokens, st: SaveToken) =>
  aPost("/call-output-data/get-user-history", payload, gt, st);

/** Fetch a specific page of the completed call history.
 *  Pagination is via URL query param ?currentPage=N (POST body is ignored for pagination). */
export const wbahGetUserHistoryPaged = (page: number, gt: GetTokens, st: SaveToken) =>
  aPost<unknown>(`/call-output-data/get-user-history?currentPage=${page}`, {}, gt, st);

export const wbahGetUserCallLead = (gt: GetTokens, st: SaveToken) =>
  aGet("/call-output-data/get-userCall-lead", gt, st);

export const wbahGetUserCallLeadPaged = (page: number, gt: GetTokens, st: SaveToken) =>
  aGet<unknown>(`/call-output-data/get-userCall-lead?currentPage=${page}`, gt, st);

export const wbahGetUserCallLeadAll = (gt: GetTokens, st: SaveToken) =>
  aGet<unknown>(`/call-output-data/get-userCall-lead?limit=10000`, gt, st);

export const wbahGetPendingCallbacks = (gt: GetTokens, st: SaveToken) =>
  aGet("/call-output-data/callbacks/pending", gt, st);

export const wbahGetCallbackSummary = (gt: GetTokens, st: SaveToken, rl?: Relogin) =>
  aGet("/call-output-data/callbacks/summary", gt, st, rl);

export const wbahGetCallbacks = (
  params: { status: string; page?: number; pageSize?: number; search?: string },
  gt: GetTokens,
  st: SaveToken,
  rl?: Relogin,
) => {
  const q = new URLSearchParams({
    status: params.status,
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 50),
  });
  if (params.search?.trim()) q.set("search", params.search.trim());
  return aGet(`/call-output-data/callbacks?${q}`, gt, st, rl);
};

export const wbahGetAllCallOutput = (gt: GetTokens, st: SaveToken) =>
  aGet("/call-output-data/all", gt, st);

// ── CRM Data ─────────────────────────────────────────────────────────────────

export const wbahGetCrmData = (gt: GetTokens, st: SaveToken) =>
  aGet("/crm-data/get-crm-data", gt, st);

/** Paginated / filtered CRM_data read (lead_status, isCallbackPending, currentPage, pageSize). */
export const wbahGetCrmDataPath = (path: string, gt: GetTokens, st: SaveToken, rl?: Relogin) =>
  aGet(path, gt, st, rl);

export const wbahCreateCrmLead = (payload: Record<string, unknown>, gt: GetTokens, st: SaveToken) =>
  aPost("/crm-data/create", payload, gt, st);

export const wbahStartBatchCalling = (gt: GetTokens, st: SaveToken) =>
  aGet("/crm-data/start-batch-calling", gt, st);

export const wbahClearAllCrmData = (gt: GetTokens, st: SaveToken) =>
  aDel("/crm-data/clear-all-crm-data", gt, st);

export const wbahDeleteSelectedCrmData = (ids: string[], gt: GetTokens, st: SaveToken) =>
  aDel("/crm-data/delete-selected-crm-data", gt, st, { ids });

export async function wbahUploadCrmExcel(
  file: File,
  getTokens: GetTokens,
  saveNewAccessToken: SaveToken,
): Promise<ApiResponse<unknown>> {
  const { accessToken } = await getTokens();
  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch(`${getWebespokeApiBaseUrl()}/crm-data/upload-excel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = JSON.parse(text); } catch { /**/ }
    return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : text.slice(0, 300) };
  } catch (err: any) {
    return { ok: false, status: 0, data: null, error: err?.message };
  }
}

// ── Campaigns ─────────────────────────────────────────────────────────────────

export const wbahGetCampaigns = (gt: GetTokens, st: SaveToken, rl?: Relogin) =>
  aGet("/campaigns", gt, st, rl);

export const wbahGetCampaignLeadStatusOptions = (gt: GetTokens, st: SaveToken, rl?: Relogin) =>
  aGet("/campaigns/lead-status-options", gt, st, rl);

export const wbahGetCampaignScheduleOptions = (gt: GetTokens, st: SaveToken, rl?: Relogin) =>
  aGet("/campaigns/schedule-options", gt, st, rl);

export const wbahCreateCampaign = (payload: Record<string, unknown>, gt: GetTokens, st: SaveToken, rl?: Relogin) =>
  aPost("/campaigns", payload, gt, st, rl);

export const wbahGetCampaign = (id: string, gt: GetTokens, st: SaveToken, rl?: Relogin) =>
  aGet(`/campaigns/${id}`, gt, st, rl);

export const wbahUpdateCampaign = (id: string, payload: Record<string, unknown>, gt: GetTokens, st: SaveToken, rl?: Relogin) =>
  aPatch(`/campaigns/${id}`, payload, gt, st, rl);

export const wbahPauseCampaign = (id: string, gt: GetTokens, st: SaveToken, rl?: Relogin) =>
  aPatch(`/campaigns/${id}/pause`, {}, gt, st, rl);

export const wbahResumeCampaign = (id: string, gt: GetTokens, st: SaveToken, rl?: Relogin) =>
  aPatch(`/campaigns/${id}/resume`, {}, gt, st, rl);

export const wbahCampaignVoicemail = (id: string, payload: Record<string, unknown>, gt: GetTokens, st: SaveToken, rl?: Relogin) =>
  aPatch(`/campaigns/${id}/voicemail`, payload, gt, st, rl);

export const wbahDeleteCampaign = (id: string, gt: GetTokens, st: SaveToken, rl?: Relogin) =>
  aDel(`/campaigns/${id}`, gt, st, undefined, rl);

export const wbahPreviewDynamicsCategorySync = (gt: GetTokens, st: SaveToken, rl?: Relogin) =>
  aGet("/campaigns/sync-dynamics-categories/preview", gt, st, rl);

export const wbahSyncDynamicsCategories = (
  scheduleCampaign: boolean,
  gt: GetTokens,
  st: SaveToken,
  rl?: Relogin,
) =>
  aPost("/campaigns/sync-dynamics-categories", { scheduleCampaign }, gt, st, rl);

// ── Agents ────────────────────────────────────────────────────────────────────

export const wbahGetAgents = (
  gt: GetTokens,
  st: SaveToken,
  rl?: Relogin,
  opts?: { campaignOnly?: boolean },
) =>
  aGet(
    `/agent/get-list${opts?.campaignOnly ? "?campaign_only=true" : ""}`,
    gt,
    st,
    rl,
  );

export const wbahGetAgentsWithVoicemail = (gt: GetTokens, st: SaveToken) =>
  aGet("/agent/get-agents-with-voicemail", gt, st);

export const wbahUpdateAgent = (payload: Record<string, unknown>, gt: GetTokens, st: SaveToken) =>
  aPost("/agent/update", payload, gt, st);

export const wbahRenameAgent = (id: string, name: string, gt: GetTokens, st: SaveToken) =>
  aPatch(`/agent/rename/${id}`, { name }, gt, st);

export const wbahAgentVoicemailSetting = (id: string, payload: Record<string, unknown>, gt: GetTokens, st: SaveToken) =>
  aPatch(`/agent/voicemailSetting/${id}`, payload, gt, st);

// ── Frequency / Call Scheduling ───────────────────────────────────────────────
// Note: route prefix is intentionally misspelled as "frquency-setting"

export const wbahGetFrequency = (payload: Record<string, unknown>, gt: GetTokens, st: SaveToken) =>
  aPost("/frquency-setting/get-frequency", payload, gt, st);

export const wbahAddFrequency = (payload: Record<string, unknown>, gt: GetTokens, st: SaveToken) =>
  aPost("/frquency-setting/add-frequency", payload, gt, st);

export const wbahUpdateFrequency = (payload: Record<string, unknown>, gt: GetTokens, st: SaveToken) =>
  aPost("/frquency-setting/update-frequency", payload, gt, st);

// ── Phone Numbers ─────────────────────────────────────────────────────────────

export const wbahGetPhoneNumbers = (gt: GetTokens, st: SaveToken) =>
  aGet("/phoneNumber/get-allphonenumbersfrom-retell", gt, st);

export const wbahUpdatePhoneNumbers = (payload: Record<string, unknown>, gt: GetTokens, st: SaveToken) =>
  aPost("/phoneNumber/update-phonenumbersfrom-retell", payload, gt, st);

export const wbahPhoneVoicemailSetting = (id: string, payload: Record<string, unknown>, gt: GetTokens, st: SaveToken) =>
  aPatch(`/phoneNumber/voicemailSetting/${id}`, payload, gt, st);

// ── Credits ───────────────────────────────────────────────────────────────────

export const wbahGetCreditSummary = (
  period: "cycle" | "week" | "month" | "year",
  gt: GetTokens,
  st: SaveToken,
  rl?: Relogin,
) => aGet(`/credits/summary?period=${period}`, gt, st, rl);

export const wbahGetCreditHistory = (gt: GetTokens, st: SaveToken, rl?: Relogin) =>
  aGet("/credits/history", gt, st, rl);

export const wbahGetMonthlyUsage = (
  granularity: "week" | "month" | "year",
  gt: GetTokens,
  st: SaveToken,
  rl?: Relogin,
) => aGet(`/credits/monthly-usage?granularity=${granularity}`, gt, st, rl);

export const wbahGetRetellUsage = (gt: GetTokens, st: SaveToken, rl?: Relogin) =>
  aGet("/credits/retell-usage", gt, st, rl);

export const wbahAllocateCredits = (payload: Record<string, unknown>, gt: GetTokens, st: SaveToken) =>
  aPost("/credits/allocate", payload, gt, st);

export const wbahDeleteAllocation = (id: string, gt: GetTokens, st: SaveToken) =>
  aDel(`/credits/allocate/${id}`, gt, st);

// ── Admin / User Management ───────────────────────────────────────────────────

export const wbahGetPermissions = (gt: GetTokens, st: SaveToken) =>
  aGet("/admin/permissions", gt, st);

export const wbahGetUsers = (gt: GetTokens, st: SaveToken) =>
  aGet("/admin/users", gt, st);

export const wbahCreateUser = (payload: Record<string, unknown>, gt: GetTokens, st: SaveToken) =>
  aPost("/admin/users", payload, gt, st);

export const wbahUpdateUser = (id: string, payload: Record<string, unknown>, gt: GetTokens, st: SaveToken) =>
  aPut(`/admin/users/${id}`, payload, gt, st);

export const wbahToggleUserStatus = (id: string, payload: Record<string, unknown>, gt: GetTokens, st: SaveToken) =>
  aPatch(`/admin/users/${id}/status`, payload, gt, st);

export const wbahDeleteUser = (id: string, gt: GetTokens, st: SaveToken) =>
  aDel(`/admin/users/${id}`, gt, st);

// ── Sync endpoints (used by admin sync engine) ────────────────────────────────
// /call-output-data/get-userCall-lead  → all leads that have been called (609+)
// /crm-data/get-crm-data              → all CRM contacts (property sellers)

export const getAllCars = (gt: GetTokens, st: SaveToken) =>
  aGet("/call-output-data/get-userCall-lead", gt, st);

export const getAllBuyers = (gt: GetTokens, st: SaveToken) =>
  aGet("/crm-data/get-crm-data", gt, st);

export const getAllDealers = (gt: GetTokens, st: SaveToken) =>
  aGet("/call-output-data/get-all-calldata", gt, st);

// ── Lead Filter Master & Status Codes (category sync) ─────────────────────────
// GET /leadfiltermaster/get-leadfiltermaster — returns the master status list
export const wbahGetLeadFilterMaster = (gt: GetTokens, st: SaveToken) =>
  aGet("/leadfiltermaster/get-leadfiltermaster", gt, st);

// GET /lead-filterStatus/get-statusCode — returns individual status codes
export const wbahGetLeadFilterStatusCodes = (gt: GetTokens, st: SaveToken) =>
  aGet("/lead-filterStatus/get-statusCode", gt, st);

// GET /crm-data/get-crm-data with optional lead status filter
export const wbahGetCrmDataFiltered = (statusCode: string, gt: GetTokens, st: SaveToken) =>
  aGet(`/crm-data/get-crm-data?leadStatus=${encodeURIComponent(statusCode)}`, gt, st);

// GET /call-output-data/get-userCall-lead with optional lead status filter
export const wbahGetLeadsFiltered = (statusCode: string, page: number, gt: GetTokens, st: SaveToken) =>
  aGet<unknown>(`/call-output-data/get-userCall-lead?leadStatus=${encodeURIComponent(statusCode)}&currentPage=${page}`, gt, st);
