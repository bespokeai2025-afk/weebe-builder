/**
 * WeeBespoke AI Enterprise — server-side API client.
 *
 * ALL calls to the external API are made here — never from the browser.
 * Tokens are never returned to the client; they live only in the DB and in
 * server-function memory during a request.
 *
 * Base: https://uat-api.webespokeai.com
 */

const BASE_URL = "https://uat-api.webespokeai.com";

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
  const url = `${BASE_URL}${path}`;
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

function extractToken(d: unknown): string | null {
  const o = d as any;
  if (!o) return null;
  return o.accessToken ?? o.token ?? o.data?.accessToken ?? o.data?.token ?? null;
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

// Shorthand helpers
function aGet<T>(path: string, gt: GetTokens, st: SaveToken) {
  return authenticatedFetch<T>(path, { method: "GET" }, gt, st);
}
function aPost<T>(path: string, body: unknown, gt: GetTokens, st: SaveToken) {
  return authenticatedFetch<T>(path, { method: "POST", body: JSON.stringify(body) }, gt, st);
}
function aPatch<T>(path: string, body: unknown, gt: GetTokens, st: SaveToken) {
  return authenticatedFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) }, gt, st);
}
function aPut<T>(path: string, body: unknown, gt: GetTokens, st: SaveToken) {
  return authenticatedFetch<T>(path, { method: "PUT", body: JSON.stringify(body) }, gt, st);
}
function aDel<T>(path: string, gt: GetTokens, st: SaveToken, body?: unknown) {
  return authenticatedFetch<T>(
    path,
    body ? { method: "DELETE", body: JSON.stringify(body) } : { method: "DELETE" },
    gt, st,
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
  return apiFetch<{ accessToken?: string; token?: string }>("/admin/refresh-token", {
    method: "POST", body: JSON.stringify({ refreshToken }),
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

export const wbahGetAllCallDataPaged = (page: number, gt: GetTokens, st: SaveToken) =>
  aGet<unknown>(`/call-output-data/get-all-calldata?page=${page}`, gt, st);

export const wbahGetCallCount = (gt: GetTokens, st: SaveToken) =>
  aGet("/call-output-data/get-call-count", gt, st);

export const wbahGetUserHistory = (payload: Record<string, unknown>, gt: GetTokens, st: SaveToken) =>
  aPost("/call-output-data/get-user-history", payload, gt, st);

export const wbahGetUserCallLead = (gt: GetTokens, st: SaveToken) =>
  aGet("/call-output-data/get-userCall-lead", gt, st);

export const wbahGetUserCallLeadPaged = (page: number, gt: GetTokens, st: SaveToken) =>
  aGet<unknown>(`/call-output-data/get-userCall-lead?page=${page}`, gt, st);

export const wbahGetPendingCallbacks = (gt: GetTokens, st: SaveToken) =>
  aGet("/call-output-data/callbacks/pending", gt, st);

export const wbahGetAllCallOutput = (gt: GetTokens, st: SaveToken) =>
  aGet("/call-output-data/all", gt, st);

// ── CRM Data ─────────────────────────────────────────────────────────────────

export const wbahGetCrmData = (gt: GetTokens, st: SaveToken) =>
  aGet("/crm-data/get-crm-data", gt, st);

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
    const res = await fetch(`${BASE_URL}/crm-data/upload-excel`, {
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

export const wbahGetCampaigns = (gt: GetTokens, st: SaveToken) =>
  aGet("/campaigns", gt, st);

export const wbahCreateCampaign = (payload: Record<string, unknown>, gt: GetTokens, st: SaveToken) =>
  aPost("/campaigns", payload, gt, st);

export const wbahGetCampaign = (id: string, gt: GetTokens, st: SaveToken) =>
  aGet(`/campaigns/${id}`, gt, st);

export const wbahUpdateCampaign = (id: string, payload: Record<string, unknown>, gt: GetTokens, st: SaveToken) =>
  aPatch(`/campaigns/${id}`, payload, gt, st);

export const wbahPauseCampaign = (id: string, gt: GetTokens, st: SaveToken) =>
  aPatch(`/campaigns/${id}/pause`, {}, gt, st);

export const wbahResumeCampaign = (id: string, gt: GetTokens, st: SaveToken) =>
  aPatch(`/campaigns/${id}/resume`, {}, gt, st);

export const wbahCampaignVoicemail = (id: string, payload: Record<string, unknown>, gt: GetTokens, st: SaveToken) =>
  aPatch(`/campaigns/${id}/voicemail`, payload, gt, st);

export const wbahDeleteCampaign = (id: string, gt: GetTokens, st: SaveToken) =>
  aDel(`/campaigns/${id}`, gt, st);

// ── Agents ────────────────────────────────────────────────────────────────────

export const wbahGetAgents = (gt: GetTokens, st: SaveToken) =>
  aGet("/agent/get-list", gt, st);

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

export const wbahGetCreditSummary = (gt: GetTokens, st: SaveToken) =>
  aGet("/credits/summary", gt, st);

export const wbahGetCreditHistory = (gt: GetTokens, st: SaveToken) =>
  aGet("/credits/history", gt, st);

export const wbahGetMonthlyUsage = (gt: GetTokens, st: SaveToken) =>
  aGet("/credits/monthly-usage", gt, st);

export const wbahGetRetellUsage = (gt: GetTokens, st: SaveToken) =>
  aGet("/credits/retell-usage", gt, st);

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
