/**
 * WeeBespoke AI Enterprise — server-side API client.
 *
 * ALL calls to the external API are made here — never from the browser.
 * Tokens are never returned to the client; they live only in the DB and in
 * server-function memory during a request.
 */

const BASE_URL = "https://uat-api.webespokeai.com";

// ── Low-level fetch ───────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

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
    try { data = JSON.parse(text) as T; } catch { /* non-JSON response */ }
    return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : text.slice(0, 300) };
  } catch (err: any) {
    return { ok: false, status: 0, data: null, error: err?.message ?? "Network error" };
  }
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// ── Auto-refresh wrapper ──────────────────────────────────────────────────────

/**
 * Make an authenticated request. If a 401 is returned, refresh the token once
 * and retry. The caller must supply callbacks to get/set the tokens so this
 * module stays stateless.
 */
export async function authenticatedFetch<T>(
  path: string,
  options: RequestInit,
  getTokens: () => Promise<{ accessToken: string; refreshToken: string }>,
  saveNewAccessToken: (token: string) => Promise<void>,
): Promise<ApiResponse<T>> {
  const { accessToken, refreshToken } = await getTokens();
  const first = await apiFetch<T>(path, {
    ...options,
    headers: { ...(options.headers ?? {}), ...authHeader(accessToken) },
  });

  if (first.status !== 401) return first;

  // Attempt token refresh
  const refreshRes = await refreshTokenRequest(refreshToken);
  if (!refreshRes.ok || !refreshRes.data) {
    return { ok: false, status: 401, data: null, error: "Token expired — reconnect required" };
  }
  const newToken = (refreshRes.data as any)?.accessToken ?? (refreshRes.data as any)?.token;
  if (!newToken) {
    return { ok: false, status: 401, data: null, error: "Refresh response missing token" };
  }
  await saveNewAccessToken(newToken);

  // Retry once with the new token
  return apiFetch<T>(path, {
    ...options,
    headers: { ...(options.headers ?? {}), ...authHeader(newToken) },
  });
}

// ── Auth endpoints ────────────────────────────────────────────────────────────

export async function requestOtp(email: string) {
  return apiFetch<{ message?: string }>("/admin/auth/request-otp", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function verifyOtp(email: string, otp: string) {
  return apiFetch<{
    accessToken?: string;
    token?: string;
    refreshToken?: string;
    user?: Record<string, unknown>;
  }>("/admin/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ email, otp }),
  });
}

export async function refreshTokenRequest(refreshToken: string) {
  return apiFetch<{ accessToken?: string; token?: string }>("/admin/refresh-token", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}

// ── Car endpoints ─────────────────────────────────────────────────────────────

export async function getAllCars(
  getTokens: () => Promise<{ accessToken: string; refreshToken: string }>,
  saveNewAccessToken: (t: string) => Promise<void>,
) {
  return authenticatedFetch<unknown[]>(
    "/product/carRoutes/get_cars_by_admin",
    { method: "GET" },
    getTokens,
    saveNewAccessToken,
  );
}

export async function updateCar(
  id: string,
  payload: Record<string, unknown>,
  getTokens: () => Promise<{ accessToken: string; refreshToken: string }>,
  saveNewAccessToken: (t: string) => Promise<void>,
) {
  return authenticatedFetch<unknown>(
    `/product/carRoutes/update_car_by_Admin/${id}`,
    { method: "PUT", body: JSON.stringify(payload) },
    getTokens,
    saveNewAccessToken,
  );
}

export async function updateCarImages(
  id: string,
  payload: Record<string, unknown>,
  getTokens: () => Promise<{ accessToken: string; refreshToken: string }>,
  saveNewAccessToken: (t: string) => Promise<void>,
) {
  return authenticatedFetch<unknown>(
    `/product/carRoutes/update_car_images/${id}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    getTokens,
    saveNewAccessToken,
  );
}

export async function getCarsByDealer(
  dealerId: string,
  getTokens: () => Promise<{ accessToken: string; refreshToken: string }>,
  saveNewAccessToken: (t: string) => Promise<void>,
) {
  return authenticatedFetch<unknown[]>(
    "/product/carRoutes/cars_by_dealerid_for_admin",
    { method: "POST", body: JSON.stringify({ dealerId }) },
    getTokens,
    saveNewAccessToken,
  );
}

// ── Buyer endpoints ───────────────────────────────────────────────────────────

export async function getAllBuyers(
  getTokens: () => Promise<{ accessToken: string; refreshToken: string }>,
  saveNewAccessToken: (t: string) => Promise<void>,
) {
  return authenticatedFetch<unknown[]>(
    "/buyer/buyerRoute/get-all-buyers",
    { method: "GET" },
    getTokens,
    saveNewAccessToken,
  );
}

// ── Dealer endpoints ──────────────────────────────────────────────────────────

export async function getAllDealers(
  getTokens: () => Promise<{ accessToken: string; refreshToken: string }>,
  saveNewAccessToken: (t: string) => Promise<void>,
) {
  return authenticatedFetch<unknown[]>(
    "/dealer/auth/get-all-dealers",
    { method: "GET" },
    getTokens,
    saveNewAccessToken,
  );
}

// ── Bike endpoints (placeholder — endpoint pattern prepared) ──────────────────

export async function getAllBikes(
  getTokens: () => Promise<{ accessToken: string; refreshToken: string }>,
  saveNewAccessToken: (t: string) => Promise<void>,
) {
  return authenticatedFetch<unknown[]>(
    "/product/bikeRoutes/get_bikes_by_admin",
    { method: "GET" },
    getTokens,
    saveNewAccessToken,
  );
}

// ── Spare Parts endpoints (placeholder — endpoint pattern prepared) ────────────

export async function getAllSpareParts(
  getTokens: () => Promise<{ accessToken: string; refreshToken: string }>,
  saveNewAccessToken: (t: string) => Promise<void>,
) {
  return authenticatedFetch<unknown[]>(
    "/product/sparePartsRoutes/get_spare_parts_by_admin",
    { method: "GET" },
    getTokens,
    saveNewAccessToken,
  );
}
