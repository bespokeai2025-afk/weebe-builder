/**
 * SystemMind API Probe Engine — server functions.
 *
 * All HTTP calls to external APIs are made here, server-side only.
 * Credentials are decrypted via AES-256-CBC; tokens are NEVER returned to the browser.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptCredentials, encryptCredentials } from "./client-api-connections.server";

// ── Internal helpers (server-side only, never exported as server fn) ──────────

async function getConnectionCreds(connectionId: string): Promise<{
  baseUrl:   string;
  authType:  string;
  creds:     Record<string, string>;
}> {
  const sb = supabaseAdmin as any;
  const { data } = await sb
    .from("client_api_connections")
    .select("base_url, auth_type, encrypted_credentials")
    .eq("id", connectionId)
    .maybeSingle();
  if (!data) throw new Error("Connection not found");

  let creds = decryptCredentials(data.encrypted_credentials ?? null);

  // If this connection references enterprise_integrations as its credential source,
  // fetch the live token from there instead of any locally-stored copy.
  // This keeps WBAH tokens in one place (enterprise_integrations) as the source of truth.
  if (creds._source === "enterprise_integrations" && creds._integration_key) {
    const { data: eiRow } = await sb
      .from("enterprise_integrations")
      .select("access_token, refresh_token, status")
      .eq("integration_key", creds._integration_key)
      .eq("client_name", creds._client_name ?? "Webuyanyhouse")
      .maybeSingle();
    if (eiRow?.access_token) {
      creds = {
        ...creds,
        accessToken:  eiRow.access_token,
        refreshToken: eiRow.refresh_token ?? "",
      };
    }
  }

  return {
    baseUrl:  data.base_url,
    authType: data.auth_type,
    creds,
  };
}

function buildAuthHeaders(authType: string, creds: Record<string, string>): Record<string, string> {
  switch (authType) {
    case "bearer_token":
      return creds.token ? { Authorization: `Bearer ${creds.token}` } : {};
    case "api_key_header":
      return creds.headerName && creds.apiKey ? { [creds.headerName]: creds.apiKey } : {};
    case "basic_auth": {
      const encoded = Buffer.from(`${creds.username ?? ""}:${creds.password ?? ""}`).toString("base64");
      return { Authorization: `Basic ${encoded}` };
    }
    case "custom_headers": {
      try { return JSON.parse(creds.headers ?? "{}"); } catch { return {}; }
    }
    case "otp": {
      const token = creds.accessToken ?? creds.token ?? "";
      return token ? { Authorization: `Bearer ${token}` } : {};
    }
    default:
      return {};
  }
}

/** Try to refresh an OTP connection's access token using the stored refreshToken */
async function tryRefreshOtpToken(connectionId: string, creds: Record<string, string>, baseUrl: string): Promise<Record<string, string> | null> {
  const refreshToken = creds.refreshToken;
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${baseUrl}/admin/auth/refresh-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const parsed = await res.json().catch(() => null);
    const newToken = parsed?.accessToken ?? parsed?.token ?? parsed?.data?.accessToken ?? null;
    if (!newToken) return null;

    const newCreds = { ...creds, accessToken: newToken };
    if (parsed?.refreshToken ?? parsed?.data?.refreshToken) {
      newCreds.refreshToken = parsed?.refreshToken ?? parsed?.data?.refreshToken;
    }

    const sb = supabaseAdmin as any;
    await sb
      .from("client_api_connections")
      .update({
        encrypted_credentials: encryptCredentials(newCreds),
        status:                "connected",
        updated_at:            new Date().toISOString(),
      })
      .eq("id", connectionId);

    return newCreds;
  } catch {
    return null;
  }
}

function detectArrayPath(data: unknown): string | null {
  if (Array.isArray(data)) return "";
  if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (Array.isArray(v)) return k;
    }
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (v && typeof v === "object") {
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
          if (Array.isArray(v2)) return `${k}.${k2}`;
        }
      }
    }
  }
  return null;
}

function getArrayAtPath(data: unknown, path: string | null): unknown[] {
  if (path == null) return [];
  if (path === "") return Array.isArray(data) ? (data as unknown[]) : [];
  const parts = path.split(".");
  let cur: unknown = data;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return [];
    cur = (cur as any)[p];
  }
  return Array.isArray(cur) ? cur : [];
}

const WEBEE_MODULES = [
  { key: "leads",     patterns: ["lead", "prospect", "contact"] },
  { key: "contacts",  patterns: ["contact", "crm", "seller", "buyer", "customer"] },
  { key: "calls",     patterns: ["call", "history", "recording", "transcript"] },
  { key: "campaigns", patterns: ["campaign", "batch", "outreach"] },
  { key: "agents",    patterns: ["agent", "bot", "assistant"] },
  { key: "analytics", patterns: ["dashboard", "stat", "metric", "count", "total", "report"] },
  { key: "credits",   patterns: ["credit", "usage", "billing", "allocation"] },
  { key: "phone",     patterns: ["phone", "number", "sip", "twilio", "tel"] },
  { key: "voicemail", patterns: ["voicemail", "vm"] },
  { key: "frequency", patterns: ["frequency", "schedule"] },
  { key: "admin",     patterns: ["admin", "user", "permission", "role"] },
  { key: "sync",      patterns: ["sync", "import", "export", "webhook"] },
];

function suggestModuleForPath(endpointPath: string, responseKeys: string[]): string[] {
  const path = endpointPath.toLowerCase();
  const keys = responseKeys.join(" ").toLowerCase();
  const scores: Record<string, number> = {};
  for (const mod of WEBEE_MODULES) {
    for (const pattern of mod.patterns) {
      if (path.includes(pattern)) scores[mod.key] = (scores[mod.key] ?? 0) + 2;
      if (keys.includes(pattern)) scores[mod.key] = (scores[mod.key] ?? 0) + 1;
    }
  }
  return Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .map(([k]) => k)
    .slice(0, 3);
}

// ── Server functions ──────────────────────────────────────────────────────────

export const testApiConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: { connectionId: string }) =>
    z.object({ connectionId: z.string() }).parse(i),
  )
  .handler(async ({ data }) => {
    const { baseUrl, authType, creds } = await getConnectionCreds(data.connectionId);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...buildAuthHeaders(authType, creds),
    };

    const start = Date.now();
    try {
      let res = await fetch(baseUrl, { method: "HEAD", headers });

      // If 401 and OTP auth, try token refresh
      if (res.status === 401 && authType === "otp") {
        const refreshed = await tryRefreshOtpToken(data.connectionId, creds, baseUrl);
        if (refreshed) {
          const newHeaders = { ...headers, ...buildAuthHeaders(authType, refreshed) };
          res = await fetch(baseUrl, { method: "HEAD", headers: newHeaders });
        }
      }

      const latencyMs = Date.now() - start;
      const sb = supabaseAdmin as any;
      await sb
        .from("client_api_connections")
        .update({ status: res.ok ? "connected" : "error", updated_at: new Date().toISOString() })
        .eq("id", data.connectionId);
      return { ok: res.ok, status: res.status, latencyMs };
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      return { ok: false, status: 0, latencyMs, error: err?.message ?? "Network error" };
    }
  });

export const probeEndpoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: {
    connectionId:  string;
    endpointPath:  string;
    method:        string;
    queryParams?:  Record<string, string>;
    body?:         Record<string, unknown>;
  }) =>
    z.object({
      connectionId:  z.string(),
      endpointPath:  z.string(),
      method:        z.string(),
      queryParams:   z.record(z.string()).optional(),
      body:          z.record(z.unknown()).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { baseUrl, authType, creds } = await getConnectionCreds(data.connectionId);

    let url = `${baseUrl}${data.endpointPath.startsWith("/") ? data.endpointPath : `/${data.endpointPath}`}`;
    if (data.queryParams && Object.keys(data.queryParams).length > 0) {
      url = `${url}?${new URLSearchParams(data.queryParams)}`;
    }

    const buildHeaders = (c: Record<string, string>) => ({
      "Content-Type": "application/json",
      ...buildAuthHeaders(authType, c),
    });

    const buildInit = (h: Record<string, string>): RequestInit => ({
      method: data.method.toUpperCase(),
      headers: h,
      ...(data.body && ["POST", "PUT", "PATCH"].includes(data.method.toUpperCase())
        ? { body: JSON.stringify(data.body) }
        : {}),
    });

    const start = Date.now();
    let responseData: unknown = null;
    let status = 0;
    let responseTime = 0;
    let errorMsg: string | undefined;

    try {
      let res = await fetch(url, buildInit(buildHeaders(creds)));
      responseTime = Date.now() - start;
      status = res.status;

      // Auto-refresh on 401 for OTP connections
      if (res.status === 401 && authType === "otp") {
        const refreshed = await tryRefreshOtpToken(data.connectionId, creds, baseUrl);
        if (refreshed) {
          res = await fetch(url, buildInit(buildHeaders(refreshed)));
          status = res.status;
          responseTime = Date.now() - start;
        }
      }

      const text = await res.text();
      try { responseData = JSON.parse(text); } catch { responseData = text; }
    } catch (err: any) {
      responseTime = Date.now() - start;
      errorMsg = err?.message ?? "Network error";
    }

    const arrayPath = detectArrayPath(responseData);
    const arr       = getArrayAtPath(responseData, arrayPath);
    const topKeys   = responseData && typeof responseData === "object"
      ? Object.keys(responseData as object)
      : [];

    const sampleRecord = arr.length > 0 ? arr[0] : null;
    const paginationKeys = topKeys.filter((k) =>
      /total|page|count|next|cursor|offset|limit|pages/i.test(k)
    );
    const suggested = suggestModuleForPath(data.endpointPath, topKeys);

    return { status, responseTime, error: errorMsg, topKeys, arrayPath, recordCount: arr.length, sampleRecord, paginationKeys, suggestedModules: suggested };
  });

export const detectPagination = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: {
    connectionId: string;
    endpointPath: string;
    method:       string;
  }) =>
    z.object({
      connectionId: z.string(),
      endpointPath: z.string(),
      method:       z.string(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { baseUrl, authType, creds } = await getConnectionCreds(data.connectionId);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...buildAuthHeaders(authType, creds),
    };
    const base = `${baseUrl}${data.endpointPath.startsWith("/") ? data.endpointPath : `/${data.endpointPath}`}`;
    const method = data.method.toUpperCase();

    // All param variants we probe (page variants × size variants + cursor + skip)
    const PAGE_PARAMS   = ["page", "currentPage", "pageNum", "offset", "skip"];
    const SIZE_PARAMS   = ["limit", "pageSize", "page_size", "perPage", "per_page", "size"];
    const CURSOR_PARAMS = ["cursor", "after", "nextCursor", "next_page_token"];
    const TOTAL_KEYS    = ["total", "totalItems", "totalCount", "count", "totalPages", "pages", "total_count"];

    type ProbeResult = { paramSet: Record<string, string>; label: string; status: number; recordCount: number; keys: string[]; rawData: unknown };
    const results: ProbeResult[] = [];

    async function probe(params: Record<string, string>, label: string): Promise<ProbeResult | null> {
      try {
        const qs  = new URLSearchParams(params).toString();
        const url = `${base}?${qs}`;
        const res = await fetch(url, { method, headers });
        const text = await res.text();
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { parsed = null; }
        const arr = getArrayAtPath(parsed, detectArrayPath(parsed));
        return {
          paramSet:    params,
          label,
          status:      res.status,
          recordCount: arr.length,
          keys:        parsed && typeof parsed === "object" ? Object.keys(parsed as object) : [],
          rawData:     parsed,
        };
      } catch {
        return null;
      }
    }

    // 1. Probe page=1 vs page=2 for each page param, paired with common sizes
    for (const pp of PAGE_PARAMS) {
      for (const sp of SIZE_PARAMS.slice(0, 2)) { // limit & pageSize
        const r1 = await probe({ [pp]: "1", [sp]: "10" }, `${pp}=1,${sp}=10`);
        const r2 = await probe({ [pp]: "2", [sp]: "10" }, `${pp}=2,${sp}=10`);
        if (r1) results.push(r1);
        if (r2) results.push(r2);
      }
    }

    // 2. Bulk: limit=10000 (no page param)
    let bulkCount = 0;
    let totalInResponse = 0;
    const bulkResult = await probe({ limit: "10000" }, "limit=10000");
    if (bulkResult) {
      results.push(bulkResult);
      bulkCount = bulkResult.recordCount;
      // Try to read totalItems/total from response
      if (bulkResult.rawData && typeof bulkResult.rawData === "object") {
        const rd = bulkResult.rawData as Record<string, unknown>;
        for (const tk of TOTAL_KEYS) {
          if (typeof rd[tk] === "number") { totalInResponse = rd[tk] as number; break; }
        }
      }
    }

    // 3. pageSize=10000 variant
    const pageSizeBulk = await probe({ pageSize: "10000" }, "pageSize=10000");
    if (pageSizeBulk && pageSizeBulk.recordCount > bulkCount) {
      bulkCount = pageSizeBulk.recordCount;
      results.push(pageSizeBulk);
    }

    // 4. Cursor probe (check if next/cursor key present)
    const cursorResult = await probe({}, "bare (no params)");
    if (cursorResult) results.push(cursorResult);

    // Determine strategy
    const p1cp = results.find((r) => r.label.startsWith("currentPage=1,"));
    const p2cp = results.find((r) => r.label.startsWith("currentPage=2,"));
    const p1p  = results.find((r) => r.label.startsWith("page=1,"));
    const p2p  = results.find((r) => r.label.startsWith("page=2,"));

    let strategy     = "unknown";
    let recommendation = "Could not determine pagination strategy automatically.";
    let detectedPageParam: string | null = null;
    let detectedSizeParam: string | null = null;

    if (p1cp && p2cp && p1cp.recordCount > 0 && p2cp.recordCount > 0 && p1cp.recordCount !== bulkCount) {
      strategy = "currentPage";
      detectedPageParam = "currentPage";
      detectedSizeParam = "pageSize";
      recommendation = `Use ?currentPage=N&pageSize=10. Page 1 → ${p1cp.recordCount} records, page 2 → ${p2cp.recordCount}.`;
    } else if (p1p && p2p && p1p.recordCount > 0 && p2p.recordCount > 0 && p1p.recordCount !== bulkCount) {
      strategy = "page";
      detectedPageParam = "page";
      detectedSizeParam = "limit";
      recommendation = `Use ?page=N&limit=10. Page 1 → ${p1p.recordCount}, page 2 → ${p2p.recordCount}.`;
    } else if (bulkCount > 0 && (totalInResponse === 0 || bulkCount >= totalInResponse)) {
      strategy = "bulk";
      recommendation = `?limit=10000 returns all ${bulkCount} records in one request — no page loop needed.`;
    } else if (bulkCount > 0) {
      strategy = "bulk_with_total";
      recommendation = `?limit=10000 fetches ${bulkCount} records; response shows total=${totalInResponse}.`;
    }

    // Detect if cursor-based pagination is hinted by response keys
    const bareKeys = cursorResult?.keys ?? [];
    const hasCursor = CURSOR_PARAMS.some((cp) => bareKeys.some((k) => k.toLowerCase().includes(cp.toLowerCase())));
    if (hasCursor && strategy === "unknown") {
      strategy = "cursor";
      recommendation = "Response contains cursor/nextPage keys — use cursor-based pagination.";
    }

    return {
      results: results.map((r) => ({
        label:       r.label,
        status:      r.status,
        recordCount: r.recordCount,
        keys:        r.keys,
      })),
      bulkCount,
      totalInResponse,
      detectedPageParam,
      detectedSizeParam,
      strategy,
      recommendation,
    };
  });

export const requestApiOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: {
    connectionId: string;
    otpEndpoint:  string;
    emailField:   string;
    emailValue:   string;
  }) =>
    z.object({
      connectionId: z.string(),
      otpEndpoint:  z.string(),
      emailField:   z.string(),
      emailValue:   z.string().email(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { baseUrl } = await getConnectionCreds(data.connectionId);
    const url = `${baseUrl}${data.otpEndpoint.startsWith("/") ? data.otpEndpoint : `/${data.otpEndpoint}`}`;
    const res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ [data.emailField]: data.emailValue }),
    });
    const text = await res.text();
    let message = "OTP sent";
    try { message = JSON.parse(text)?.message ?? message; } catch { /* ignore */ }
    if (!res.ok) throw new Error(`OTP request failed (${res.status}): ${text.slice(0, 200)}`);
    return { ok: true, message };
  });

export const verifyApiOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: {
    connectionId:   string;
    verifyEndpoint: string;
    emailField:     string;
    emailValue:     string;
    otpField:       string;
    otpValue:       string;
  }) =>
    z.object({
      connectionId:   z.string(),
      verifyEndpoint: z.string(),
      emailField:     z.string(),
      emailValue:     z.string().email(),
      otpField:       z.string(),
      otpValue:       z.string().min(4),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { baseUrl, creds: existingCreds } = await getConnectionCreds(data.connectionId);
    const url = `${baseUrl}${data.verifyEndpoint.startsWith("/") ? data.verifyEndpoint : `/${data.verifyEndpoint}`}`;
    const res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        [data.emailField]: data.emailValue,
        [data.otpField]:   data.otpValue,
      }),
    });
    const text = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* ignore */ }
    if (!res.ok) throw new Error(`OTP verify failed (${res.status}): ${text.slice(0, 200)}`);

    const token        = parsed?.accessToken ?? parsed?.token ?? parsed?.data?.accessToken ?? parsed?.data?.token ?? null;
    const refreshToken = parsed?.refreshToken ?? parsed?.data?.refreshToken ?? null;
    if (!token) throw new Error("Verification succeeded but no access token in response.");

    // Merge with existing creds, store AES-encrypted server-side
    const newCreds: Record<string, string> = { ...existingCreds, accessToken: token };
    if (refreshToken) newCreds.refreshToken = refreshToken;

    const sb = supabaseAdmin as any;
    await sb
      .from("client_api_connections")
      .update({
        encrypted_credentials: encryptCredentials(newCreds),
        status:                "connected",
        updated_at:            new Date().toISOString(),
      })
      .eq("id", data.connectionId);

    return { ok: true };
  });

export const suggestModuleMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: { endpointPath: string; responseKeys?: string[] }) =>
    z.object({ endpointPath: z.string(), responseKeys: z.array(z.string()).optional() }).parse(i),
  )
  .handler(async ({ data }) => {
    return suggestModuleForPath(data.endpointPath, data.responseKeys ?? []);
  });
