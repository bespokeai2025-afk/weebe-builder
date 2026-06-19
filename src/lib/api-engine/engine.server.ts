/**
 * WEBEE API Engine — server-side only.
 *
 * Handles all external API calls for client data sources:
 * auth (Bearer, API Key, OTP, Custom Headers, EnterpriseIntegration),
 * token refresh, pagination (page, offset, cursor, bulk),
 * rate limiting (token-bucket per base URL), retry with exponential backoff,
 * and response normalisation.
 *
 * Never imported from the browser — only from .server.ts files.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptCredentials } from "@/lib/systemmind/client-api-connections.server";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuthStrategy = "bearer_token" | "api_key_header" | "basic_auth" | "otp" | "custom_headers" | "enterprise_integration";

export type PaginationStrategy = "page" | "offset" | "cursor" | "bulk" | "none";

export interface EngineRequest {
  baseUrl:            string;
  endpointPath:       string;
  method:             "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  queryParams?:       Record<string, string>;
  bodyTemplate?:      Record<string, unknown>;
  authStrategy:       AuthStrategy;
  credentials:        Record<string, string>;
  timeoutMs?:         number;
  retryCount?:        number;
  rateLimitRps?:      number;
}

export interface EngineResponse {
  ok:         boolean;
  status:     number;
  raw:        unknown;
  latencyMs:  number;
  error?:     string;
}

export interface PaginationRequest extends EngineRequest {
  paginationStrategy: PaginationStrategy;
  pageParam?:         string;
  pageSizeParam?:     string;
  pageSize?:          number;
  offsetParam?:       string;
  cursorPath?:        string;
  arrayPath?:         string;
}

export interface NormalisedList {
  rows:       unknown[];
  total:      number;
  page:       number;
  totalPages: number;
}

export interface NormalisedMetrics {
  metrics: Record<string, unknown>;
}

// ── Rate limiter (token bucket per base URL) ──────────────────────────────────

const _rateBuckets = new Map<string, { tokens: number; lastRefill: number }>();

async function enforceRateLimit(baseUrl: string, rps: number): Promise<void> {
  if (!rps || rps <= 0) return;
  const key = baseUrl.replace(/\/+$/, "").toLowerCase();
  const now = Date.now();
  let bucket = _rateBuckets.get(key);
  if (!bucket) {
    bucket = { tokens: rps, lastRefill: now };
    _rateBuckets.set(key, bucket);
  }
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens  = Math.min(rps, bucket.tokens + elapsed * rps);
  bucket.lastRefill = now;
  if (bucket.tokens < 1) {
    const waitMs = Math.ceil((1 - bucket.tokens) / rps * 1000);
    console.log(`[api-engine] rate-limit pause ${waitMs}ms (${key}, ${rps} rps)`);
    await new Promise(r => setTimeout(r, waitMs));
    bucket.tokens = 0;
  } else {
    bucket.tokens -= 1;
  }
}

// ── Auth header builder ────────────────────────────────────────────────────────

function buildAuthHeaders(strategy: AuthStrategy, creds: Record<string, string>): Record<string, string> {
  switch (strategy) {
    case "bearer_token":
    case "enterprise_integration": {
      const token = creds.accessToken ?? creds.token ?? creds.bearer ?? creds.access_token ?? "";
      return token ? { Authorization: `Bearer ${token}` } : {};
    }
    case "api_key_header": {
      const headerName = creds.headerName ?? "X-API-Key";
      const apiKey     = creds.apiKey ?? creds.api_key ?? creds.key ?? "";
      return apiKey ? { [headerName]: apiKey } : {};
    }
    case "basic_auth": {
      const user    = creds.username ?? creds.user ?? "";
      const pass    = creds.password ?? creds.pass ?? "";
      const encoded = Buffer.from(`${user}:${pass}`).toString("base64");
      return { Authorization: `Basic ${encoded}` };
    }
    case "custom_headers": {
      try { return JSON.parse(creds.headers ?? "{}"); } catch { return {}; }
    }
    case "otp":
      return creds.accessToken ? { Authorization: `Bearer ${creds.accessToken}` } : {};
    default:
      return {};
  }
}

// ── Low-level HTTP fetch ───────────────────────────────────────────────────────

async function rawFetch(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: unknown,
  timeoutMs = 30_000,
): Promise<{ status: number; data: unknown; ok: boolean; error?: string }> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body:    body !== undefined ? JSON.stringify(body) : undefined,
      signal:  controller.signal,
    });
    clearTimeout(timer);
    if (res.status === 204) return { status: 204, data: null, ok: true };
    const text = await res.text();
    let data: unknown = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, ok: res.ok, error: res.ok ? undefined : text.slice(0, 400) };
  } catch (err: any) {
    clearTimeout(timer);
    const msg = err?.name === "AbortError"
      ? `Timeout after ${timeoutMs}ms`
      : (err?.message ?? "Network error");
    return { status: 0, data: null, ok: false, error: msg };
  }
}

// ── Array extractor (handles all known WeeBespoke / generic shapes) ───────────

function extractArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const o = raw as any;
  if (!o || typeof o !== "object") return [];
  for (const k of ["data", "rows", "records", "items", "leads", "calls", "contacts",
                   "result", "list", "docs", "payload", "response", "callLeads",
                   "callData", "userCallLeads"]) {
    if (Array.isArray(o[k])) return o[k];
  }
  for (const v of Object.values(o)) {
    if (Array.isArray(v) && (v as any[]).length > 0) return v as any[];
  }
  return [];
}

function extractPagination(raw: unknown): { totalItems: number | null; pageSize: number | null; nextCursor: string | null } {
  const o = raw as any;
  const p = o?.pagination ?? o?.meta ?? o?.paging ?? {};
  const totalItems = p.totalItems ?? p.totalRecords ?? p.total_records ?? p.total_count ?? p.count ?? p.total ?? null;
  const pageSize   = p.pageSize   ?? p.page_size    ?? p.limit        ?? p.perPage     ?? p.per_page ?? null;
  const nextCursor = p.nextCursor ?? p.next_cursor  ?? p.cursor       ?? o?.nextCursor ?? null;
  return { totalItems, pageSize, nextCursor };
}

// ── WebeeApiEngine ────────────────────────────────────────────────────────────

export class WebeeApiEngine {

  // ── execute: single HTTP call with retry + backoff + rate limiting ───────────

  async execute(req: EngineRequest): Promise<EngineResponse> {
    const url        = this._buildUrl(req.baseUrl, req.endpointPath, req.queryParams);
    const headers    = buildAuthHeaders(req.authStrategy, req.credentials);
    const maxRetries = req.retryCount  ?? 3;
    const timeoutMs  = req.timeoutMs   ?? 30_000;
    const rps        = req.rateLimitRps ?? 0;

    await enforceRateLimit(req.baseUrl, rps);

    let lastError  = "";
    let lastStatus = 0;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** attempt, 10_000)));
        await enforceRateLimit(req.baseUrl, rps);
      }
      const t0  = Date.now();
      const res = await rawFetch(url, req.method, headers, req.bodyTemplate, timeoutMs);
      const latencyMs = Date.now() - t0;

      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
        return { ok: res.ok, status: res.status, raw: res.data, latencyMs, error: res.error };
      }

      lastError  = res.error ?? `HTTP ${res.status}`;
      lastStatus = res.status;

      if (res.status === 401) {
        return { ok: false, status: 401, raw: null, latencyMs, error: "Unauthorized — token may be expired" };
      }
    }

    return { ok: false, status: lastStatus, raw: null, latencyMs: 0, error: lastError };
  }

  // ── paginate: wraps execute in a loop, returns all records ──────────────────

  async paginate(req: PaginationRequest): Promise<{ rows: unknown[]; total: number; pagesFetched: number }> {
    const {
      paginationStrategy,
      pageParam     = "currentPage",
      pageSizeParam = "pageSize",
      pageSize      = 50,
      offsetParam   = "offset",
      arrayPath,
    } = req;

    if (paginationStrategy === "none" || paginationStrategy === "bulk") {
      const res        = await this.execute(req);
      const rows       = arrayPath ? this._getPath(res.raw, arrayPath) : extractArray(res.raw);
      const { totalItems } = extractPagination(res.raw);
      return { rows, total: totalItems ?? rows.length, pagesFetched: 1 };
    }

    const allRows: unknown[] = [];
    let pagesFetched = 0;
    let page         = 1;
    let offset       = 0;
    let cursor: string | null = null;
    let reportedTotal: number | null = null;
    const MAX_PAGES  = 500;

    while (pagesFetched < MAX_PAGES) {
      const pageReq = this._applyPagination(req, { page, offset, cursor, pageParam, pageSizeParam, pageSize, offsetParam });
      const res = await this.execute(pageReq);
      if (!res.ok) break;

      const rows = arrayPath ? this._getPath(res.raw, arrayPath) : extractArray(res.raw);
      pagesFetched++;

      if (rows.length === 0) break;
      allRows.push(...rows);

      const pag = extractPagination(res.raw);
      // Capture authoritative total from the first page that provides it
      if (reportedTotal === null && pag.totalItems !== null) {
        reportedTotal = pag.totalItems;
      }
      cursor = pag.nextCursor;

      if (paginationStrategy === "cursor" && !cursor) break;
      if (paginationStrategy === "offset") {
        offset += rows.length;
        if (reportedTotal !== null && offset >= reportedTotal) break;
      }
      if (paginationStrategy === "page") {
        const effectivePageSize = pag.pageSize ?? pageSize;
        if (reportedTotal !== null) {
          const computedPages = Math.ceil(reportedTotal / (effectivePageSize || pageSize));
          if (page >= computedPages) break;
        } else if (rows.length < pageSize) {
          break;
        }
        page++;
      }
    }

    return {
      rows:         allRows,
      total:        reportedTotal ?? allRows.length,
      pagesFetched,
    };
  }

  // ── normalise: maps raw response into WEBEE envelope ────────────────────────

  normalise(
    raw:           unknown,
    moduleKey:     string,
    fieldMapping?: Record<string, unknown>,
  ): NormalisedList | NormalisedMetrics {
    const isDashboard = moduleKey === "analytics" || moduleKey === "credits";

    if (isDashboard) {
      const metrics = this._applyFieldMapping(raw, fieldMapping ?? {});
      return {
        metrics: typeof metrics === "object" && metrics !== null
          ? metrics as Record<string, unknown>
          : { raw },
      };
    }

    const rows       = extractArray(raw);
    const { totalItems, pageSize } = extractPagination(raw);
    const mappedRows = fieldMapping && Object.keys(fieldMapping).length > 0
      ? rows.map(r => this._applyFieldMapping(r, fieldMapping))
      : rows;
    const total      = totalItems ?? rows.length;
    const pageCount  = totalItems && pageSize ? Math.ceil(totalItems / pageSize) : 1;

    return { rows: mappedRows, total, page: 1, totalPages: pageCount };
  }

  // ── refreshToken: re-runs auth and saves updated credentials ────────────────

  async refreshToken(connectionId: string): Promise<{ ok: boolean; newToken?: string }> {
    const sb = supabaseAdmin as any;
    const { data: conn } = await sb
      .from("client_api_connections")
      .select("base_url, auth_type, encrypted_credentials")
      .eq("id", connectionId)
      .maybeSingle();

    if (!conn) return { ok: false };
    const creds = decryptCredentials(conn.encrypted_credentials);

    if (conn.auth_type === "otp") {
      if (!creds.email) return { ok: false };
      const res = await rawFetch(`${conn.base_url}/admin/auth/request-otp`, "POST", {}, { email: creds.email });
      if (res.ok) {
        console.log(`[api-engine] OTP re-requested for connection ${connectionId}`);
        return { ok: true };
      }
      return { ok: false };
    }

    if (conn.auth_type === "bearer_token" && creds.refreshToken) {
      const res = await rawFetch(`${conn.base_url}/admin/refresh-token`, "POST", {}, { refreshToken: creds.refreshToken });
      if (res.ok) {
        const d = res.data as any;
        const newToken = d?.accessToken ?? d?.token ?? d?.data?.accessToken ?? null;
        if (newToken) {
          const newCreds = { ...creds, accessToken: newToken, token: newToken };
          const { encryptCredentials } = await import("@/lib/systemmind/client-api-connections.server");
          await sb.from("client_api_connections")
            .update({ encrypted_credentials: encryptCredentials(newCreds), updated_at: new Date().toISOString() })
            .eq("id", connectionId);
          return { ok: true, newToken };
        }
      }
    }

    return { ok: false };
  }

  // ── internal helpers ─────────────────────────────────────────────────────────

  private _buildUrl(base: string, path: string, params?: Record<string, string>): string {
    const url = `${base.replace(/\/$/, "")}${path}`;
    if (!params || Object.keys(params).length === 0) return url;
    const qs = new URLSearchParams(params).toString();
    return `${url}?${qs}`;
  }

  private _applyPagination(
    req: PaginationRequest,
    opts: { page: number; offset: number; cursor: string | null; pageParam: string; pageSizeParam: string; pageSize: number; offsetParam: string },
  ): EngineRequest {
    const { page, offset, cursor, pageParam, pageSizeParam, pageSize, offsetParam } = opts;
    const qp = { ...(req.queryParams ?? {}) };
    const bt = { ...(req.bodyTemplate ?? {}) };

    if (req.paginationStrategy === "page") {
      if (req.method === "GET") qp[pageParam] = String(page);
      else bt[pageParam] = page;
      if (req.method === "GET") qp[pageSizeParam] = String(pageSize);
      else bt[pageSizeParam] = pageSize;
    } else if (req.paginationStrategy === "offset") {
      if (req.method === "GET") { qp[offsetParam] = String(offset); qp["limit"] = String(pageSize); }
      else { bt[offsetParam] = offset; bt["limit"] = pageSize; }
    } else if (req.paginationStrategy === "cursor" && cursor) {
      if (req.method === "GET") qp["cursor"] = cursor;
      else bt["cursor"] = cursor;
    }

    return { ...req, queryParams: qp, bodyTemplate: bt };
  }

  private _getPath(obj: unknown, path: string): unknown[] {
    const parts = path.split(".");
    let cur: any = obj;
    for (const p of parts) {
      if (cur == null) return [];
      cur = cur[p];
    }
    return Array.isArray(cur) ? cur : [];
  }

  private _applyFieldMapping(record: unknown, mapping: Record<string, unknown>): Record<string, unknown> {
    if (!mapping || Object.keys(mapping).length === 0) return record as Record<string, unknown>;
    const src = record as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [webeKey, srcKey] of Object.entries(mapping)) {
      out[webeKey] = src[srcKey as string] ?? null;
    }
    for (const [k, v] of Object.entries(src)) {
      if (!(k in out)) out[k] = v;
    }
    return out;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const webeeApiEngine = new WebeeApiEngine();

// ── Engine Log writer (fire-and-forget) ───────────────────────────────────────

export async function writeEngineLog(opts: {
  workspaceId:    string;
  profileId?:     string | null;
  dataSourceKey:  string;
  moduleKey:      string;
  endpointPath:   string;
  httpMethod:     string;
  statusCode?:    number;
  latencyMs?:     number;
  recordCount?:   number;
  totalReported?: number;
  pageFetched?:   number;
  errorMsg?:      string | null;
}): Promise<void> {
  try {
    await (supabaseAdmin as any).from("api_engine_logs").insert({
      workspace_id:    opts.workspaceId,
      profile_id:      opts.profileId ?? null,
      data_source_key: opts.dataSourceKey,
      module_key:      opts.moduleKey,
      endpoint_path:   opts.endpointPath,
      http_method:     opts.httpMethod,
      status_code:     opts.statusCode   ?? null,
      latency_ms:      opts.latencyMs    ?? null,
      record_count:    opts.recordCount  ?? null,
      total_reported:  opts.totalReported ?? null,
      page_fetched:    opts.pageFetched   ?? null,
      error_msg:       opts.errorMsg      ?? null,
      requested_at:    new Date().toISOString(),
    });
  } catch (err: any) {
    console.warn("[api-engine] failed to write engine log:", err?.message);
  }
}
