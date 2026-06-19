/**
 * WEBEE Data Source Router — server-side only.
 *
 * Resolves workspace API profiles and dispatches requests through
 * WebeeApiEngine, exposing typed functions for each Smart Dash module.
 *
 * When no profile/mapping is configured, returns source:"fallback" so
 * callers can delegate to their own direct integration path.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptCredentials } from "@/lib/systemmind/client-api-connections.server";
import {
  webeeApiEngine,
  writeEngineLog,
  type NormalisedList,
  type NormalisedMetrics,
  type AuthStrategy,
  type PaginationStrategy,
  type EngineRequest,
} from "./engine.server";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ListEnvelope {
  rows:       unknown[];
  total:      number;
  page:       number;
  totalPages: number;
  source:     "engine" | "fallback";
}

export interface MetricsEnvelope {
  metrics: Record<string, unknown>;
  source:  "engine" | "fallback";
}

export interface Pagination {
  page:     number;
  pageSize: number;
}

// ── Profile ───────────────────────────────────────────────────────────────────

interface WorkspaceApiProfile {
  id:                  string;
  data_source_key:     string;
  display_name:        string;
  connection_id:       string | null;
  module_mappings:     Record<string, string>;
  auth_strategy:       AuthStrategy;
  pagination_strategy: PaginationStrategy;
  engine_config:       Record<string, unknown>;
}

async function resolveProfile(workspaceId: string): Promise<WorkspaceApiProfile | null> {
  const { data } = await (supabaseAdmin as any)
    .from("workspace_api_profiles")
    .select("id, data_source_key, display_name, connection_id, module_mappings, auth_strategy, pagination_strategy, engine_config")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function resolveConnectionCreds(connectionId: string): Promise<{ creds: Record<string, string>; baseUrl: string }> {
  const { data } = await (supabaseAdmin as any)
    .from("client_api_connections")
    .select("base_url, encrypted_credentials, auth_type")
    .eq("id", connectionId)
    .maybeSingle();
  if (!data) return { creds: {}, baseUrl: "" };
  return {
    creds:   decryptCredentials(data.encrypted_credentials ?? null),
    baseUrl: data.base_url ?? "",
  };
}

async function resolveMapping(mappingId: string): Promise<Record<string, any> | null> {
  const { data } = await (supabaseAdmin as any)
    .from("client_api_endpoint_mappings")
    .select("*")
    .eq("id", mappingId)
    .maybeSingle();
  return data ?? null;
}

// ── WBAH enterprise credentials ───────────────────────────────────────────────
// Used when auth_strategy === "enterprise_integration": tokens live in
// enterprise_integrations, not client_api_connections.

async function getWbahTokens(): Promise<{ accessToken: string; refreshToken: string } | null> {
  const { data } = await (supabaseAdmin as any)
    .from("enterprise_integrations")
    .select("access_token, refresh_token, status")
    .eq("integration_key", "webespoke_enterprise")
    .eq("client_name", "Webuyanyhouse")
    .maybeSingle();
  if (!data || data.status !== "connected" || !data.access_token) return null;
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? "" };
}

// ── Credential + base URL resolver ───────────────────────────────────────────

async function loadAuth(profile: WorkspaceApiProfile): Promise<{ creds: Record<string, string>; baseUrl: string }> {
  if (profile.auth_strategy === "enterprise_integration") {
    const tokens  = await getWbahTokens();
    const baseUrl = (profile.engine_config?.base_url as string) ?? "https://api2.webespoke.com";
    if (!tokens) throw new Error("enterprise_integration: WBAH tokens not connected");
    return { creds: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }, baseUrl };
  }
  if (!profile.connection_id) return { creds: {}, baseUrl: "" };
  return resolveConnectionCreds(profile.connection_id);
}

// ── Core dispatch ─────────────────────────────────────────────────────────────

interface DispatchResult {
  rows:         unknown[];
  rawForMetrics: unknown;
  total:        number;
  pagesFetched: number;
  latencyMs:    number;
  ok:           boolean;
  status:       number;
  endpointPath: string;
  method:       string;
  fieldMapping: Record<string, unknown>;
  error?:       string;
}

async function dispatchEngineCall(
  workspaceId:      string,
  profile:          WorkspaceApiProfile,
  moduleKey:        string,
  extraQueryParams?: Record<string, string>,
): Promise<DispatchResult | null> {
  const mappingId = profile.module_mappings[moduleKey];
  if (!mappingId) return null;

  const mapping = await resolveMapping(mappingId);
  if (!mapping) return null;

  const { creds, baseUrl } = await loadAuth(profile);
  if (!baseUrl) return null;

  const qp               = { ...(mapping.query_params ?? {}), ...(extraQueryParams ?? {}) };
  const timeoutMs        = (profile.engine_config?.timeout_ms    as number) ?? 30_000;
  const retryCount       = (profile.engine_config?.retry_count   as number) ?? 3;
  const pageSize         = (profile.engine_config?.page_size     as number) ?? 50;
  const rateLimitRps     = (profile.engine_config?.rate_limit_rps as number) ?? 0;
  const paginationStrategy = profile.pagination_strategy;
  const endpointPath     = mapping.endpoint_path as string;
  const method           = (mapping.method ?? "GET") as "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  const fieldMapping     = (mapping.field_mapping ?? {}) as Record<string, unknown>;

  const baseReq: EngineRequest = {
    baseUrl,
    endpointPath,
    method,
    queryParams:   Object.keys(qp).length > 0 ? qp : undefined,
    bodyTemplate:  mapping.body_template ?? undefined,
    authStrategy:  profile.auth_strategy,
    credentials:   creds,
    timeoutMs,
    retryCount,
    rateLimitRps,
  };

  const t0 = Date.now();

  // ── Use paginate() for multi-page strategies ─────────────────────────────
  if (paginationStrategy !== "none") {
    try {
      const result = await webeeApiEngine.paginate({
        ...baseReq,
        paginationStrategy,
        pageSize,
        arrayPath: mapping.array_path ?? undefined,
      });
      return {
        rows:          result.rows,
        rawForMetrics: null,
        total:         result.total,
        pagesFetched:  result.pagesFetched,
        latencyMs:     Date.now() - t0,
        ok:            true,
        status:        200,
        endpointPath,
        method,
        fieldMapping,
      };
    } catch (err: any) {
      return {
        rows: [], rawForMetrics: null, total: 0, pagesFetched: 0,
        latencyMs: Date.now() - t0, ok: false, status: 0,
        endpointPath, method, fieldMapping, error: err?.message ?? "paginate failed",
      };
    }
  }

  // ── Single execute() call (strategy === "none") ──────────────────────────
  const res = await webeeApiEngine.execute(baseReq);

  // ── 401 retry: re-login for enterprise_integration ───────────────────────
  if (res.status === 401 && profile.auth_strategy === "enterprise_integration") {
    try {
      const { loginWithPassword } = await import("@/lib/integrations/webespokeEnterprise/client.server");
      const password = process.env.WEBESPOKE_ADMIN_PASSWORD;
      const email    = process.env.WEBESPOKE_ADMIN_EMAIL;
      if (password && email) {
        const loginRes = await loginWithPassword(email, password);
        if (loginRes.ok && loginRes.data) {
          const d        = loginRes.data as any;
          const newToken = d?.accessToken ?? d?.token ?? d?.data?.accessToken ?? null;
          if (newToken) {
            const retryReq: EngineRequest = { ...baseReq, credentials: { accessToken: newToken } };
            const retry = await webeeApiEngine.execute(retryReq);
            if (retry.ok) {
              const rows = Array.isArray(retry.raw) ? retry.raw : [];
              return {
                rows, rawForMetrics: retry.raw, total: rows.length, pagesFetched: 1,
                latencyMs: Date.now() - t0, ok: true, status: retry.status,
                endpointPath, method, fieldMapping,
              };
            }
          }
        }
      }
    } catch { /* fall through */ }
  }

  if (!res.ok) {
    return {
      rows: [], rawForMetrics: null, total: 0, pagesFetched: 0,
      latencyMs: res.latencyMs, ok: false, status: res.status,
      endpointPath, method, fieldMapping, error: res.error,
    };
  }

  const rows = Array.isArray(res.raw) ? res.raw : [];
  return {
    rows,
    rawForMetrics: res.raw,
    total:         rows.length,
    pagesFetched:  1,
    latencyMs:     res.latencyMs,
    ok:            true,
    status:        res.status,
    endpointPath,
    method,
    fieldMapping,
  };
}

// ── getDashboardData ──────────────────────────────────────────────────────────

export async function getDashboardData(workspaceId: string): Promise<MetricsEnvelope> {
  const profile = await resolveProfile(workspaceId);
  if (!profile?.module_mappings?.analytics) return { metrics: {}, source: "fallback" };
  try {
    const res = await dispatchEngineCall(workspaceId, profile, "analytics");
    if (!res) return { metrics: {}, source: "fallback" };
    await writeEngineLog({
      workspaceId, profileId: profile.id, dataSourceKey: profile.data_source_key,
      moduleKey: "analytics", endpointPath: res.endpointPath, httpMethod: res.method,
      statusCode: res.status, latencyMs: res.latencyMs,
      recordCount: res.rows.length, totalReported: res.total, pageFetched: res.pagesFetched,
      errorMsg: res.ok ? null : (res.error ?? `HTTP ${res.status}`),
    });
    if (!res.ok) return { metrics: {}, source: "fallback" };
    const normalised = webeeApiEngine.normalise(res.rawForMetrics ?? res.rows, "analytics", res.fieldMapping) as NormalisedMetrics;
    return { ...normalised, source: "engine" };
  } catch { return { metrics: {}, source: "fallback" }; }
}

// ── getPeopleData ─────────────────────────────────────────────────────────────

export async function getPeopleData(workspaceId: string, pagination: Pagination = { page: 1, pageSize: 50 }): Promise<ListEnvelope> {
  const profile = await resolveProfile(workspaceId);
  if (!profile?.module_mappings?.leads) {
    return { rows: [], total: 0, page: pagination.page, totalPages: 0, source: "fallback" };
  }
  try {
    const res = await dispatchEngineCall(workspaceId, profile, "leads", {
      currentPage: String(pagination.page),
      pageSize:    String(pagination.pageSize),
    });
    if (!res) return { rows: [], total: 0, page: pagination.page, totalPages: 0, source: "fallback" };
    await writeEngineLog({
      workspaceId, profileId: profile.id, dataSourceKey: profile.data_source_key,
      moduleKey: "leads", endpointPath: res.endpointPath, httpMethod: res.method,
      statusCode: res.status, latencyMs: res.latencyMs,
      recordCount: res.rows.length, totalReported: res.total, pageFetched: res.pagesFetched,
      errorMsg: res.ok ? null : (res.error ?? `HTTP ${res.status}`),
    });
    if (!res.ok) return { rows: [], total: 0, page: pagination.page, totalPages: 0, source: "fallback" };
    const normalised = webeeApiEngine.normalise(res.rows, "leads", res.fieldMapping) as NormalisedList;
    return { rows: normalised.rows, total: res.total, page: pagination.page, totalPages: normalised.totalPages, source: "engine" };
  } catch { return { rows: [], total: 0, page: pagination.page, totalPages: 0, source: "fallback" }; }
}

// ── getCRMData ────────────────────────────────────────────────────────────────

export async function getCRMData(workspaceId: string, pagination: Pagination = { page: 1, pageSize: 50 }): Promise<ListEnvelope> {
  const profile = await resolveProfile(workspaceId);
  if (!profile?.module_mappings?.contacts) {
    return { rows: [], total: 0, page: pagination.page, totalPages: 0, source: "fallback" };
  }
  try {
    const res = await dispatchEngineCall(workspaceId, profile, "contacts", {
      currentPage: String(pagination.page),
    });
    if (!res) return { rows: [], total: 0, page: pagination.page, totalPages: 0, source: "fallback" };
    await writeEngineLog({
      workspaceId, profileId: profile.id, dataSourceKey: profile.data_source_key,
      moduleKey: "contacts", endpointPath: res.endpointPath, httpMethod: res.method,
      statusCode: res.status, latencyMs: res.latencyMs,
      recordCount: res.rows.length, totalReported: res.total, pageFetched: res.pagesFetched,
      errorMsg: res.ok ? null : (res.error ?? `HTTP ${res.status}`),
    });
    if (!res.ok) return { rows: [], total: 0, page: pagination.page, totalPages: 0, source: "fallback" };
    const normalised = webeeApiEngine.normalise(res.rows, "contacts", res.fieldMapping) as NormalisedList;
    return { rows: normalised.rows, total: res.total, page: pagination.page, totalPages: normalised.totalPages, source: "engine" };
  } catch { return { rows: [], total: 0, page: pagination.page, totalPages: 0, source: "fallback" }; }
}

// ── getCallsData ──────────────────────────────────────────────────────────────

export async function getCallsData(workspaceId: string, pagination: Pagination = { page: 1, pageSize: 50 }): Promise<ListEnvelope> {
  const profile = await resolveProfile(workspaceId);
  if (!profile?.module_mappings?.calls) {
    return { rows: [], total: 0, page: pagination.page, totalPages: 0, source: "fallback" };
  }
  try {
    const res = await dispatchEngineCall(workspaceId, profile, "calls", {
      currentPage: String(pagination.page),
    });
    if (!res) return { rows: [], total: 0, page: pagination.page, totalPages: 0, source: "fallback" };
    await writeEngineLog({
      workspaceId, profileId: profile.id, dataSourceKey: profile.data_source_key,
      moduleKey: "calls", endpointPath: res.endpointPath, httpMethod: res.method,
      statusCode: res.status, latencyMs: res.latencyMs,
      recordCount: res.rows.length, totalReported: res.total, pageFetched: res.pagesFetched,
      errorMsg: res.ok ? null : (res.error ?? `HTTP ${res.status}`),
    });
    if (!res.ok) return { rows: [], total: 0, page: pagination.page, totalPages: 0, source: "fallback" };
    const normalised = webeeApiEngine.normalise(res.rows, "calls", res.fieldMapping) as NormalisedList;
    return { rows: normalised.rows, total: res.total, page: pagination.page, totalPages: normalised.totalPages, source: "engine" };
  } catch { return { rows: [], total: 0, page: pagination.page, totalPages: 0, source: "fallback" }; }
}

// ── getCampaignData ───────────────────────────────────────────────────────────

export async function getCampaignData(workspaceId: string, pagination: Pagination = { page: 1, pageSize: 50 }): Promise<ListEnvelope> {
  const profile = await resolveProfile(workspaceId);
  if (!profile?.module_mappings?.campaigns) {
    return { rows: [], total: 0, page: pagination.page, totalPages: 0, source: "fallback" };
  }
  try {
    const res = await dispatchEngineCall(workspaceId, profile, "campaigns");
    if (!res) return { rows: [], total: 0, page: pagination.page, totalPages: 0, source: "fallback" };
    await writeEngineLog({
      workspaceId, profileId: profile.id, dataSourceKey: profile.data_source_key,
      moduleKey: "campaigns", endpointPath: res.endpointPath, httpMethod: res.method,
      statusCode: res.status, latencyMs: res.latencyMs,
      recordCount: res.rows.length, totalReported: res.total, pageFetched: res.pagesFetched,
      errorMsg: res.ok ? null : (res.error ?? `HTTP ${res.status}`),
    });
    if (!res.ok) return { rows: [], total: 0, page: pagination.page, totalPages: 0, source: "fallback" };
    const normalised = webeeApiEngine.normalise(res.rows, "campaigns", res.fieldMapping) as NormalisedList;
    return { rows: normalised.rows, total: res.total, page: pagination.page, totalPages: 1, source: "engine" };
  } catch { return { rows: [], total: 0, page: pagination.page, totalPages: 0, source: "fallback" }; }
}

// ── getCreditsData ────────────────────────────────────────────────────────────

export async function getCreditsData(workspaceId: string): Promise<MetricsEnvelope> {
  const profile = await resolveProfile(workspaceId);
  if (!profile?.module_mappings?.credits) return { metrics: {}, source: "fallback" };
  try {
    const res = await dispatchEngineCall(workspaceId, profile, "credits");
    if (!res) return { metrics: {}, source: "fallback" };
    await writeEngineLog({
      workspaceId, profileId: profile.id, dataSourceKey: profile.data_source_key,
      moduleKey: "credits", endpointPath: res.endpointPath, httpMethod: res.method,
      statusCode: res.status, latencyMs: res.latencyMs,
      recordCount: res.rows.length, totalReported: res.total, pageFetched: res.pagesFetched,
      errorMsg: res.ok ? null : (res.error ?? `HTTP ${res.status}`),
    });
    if (!res.ok) return { metrics: {}, source: "fallback" };
    const normalised = webeeApiEngine.normalise(res.rawForMetrics ?? res.rows, "credits", res.fieldMapping) as NormalisedMetrics;
    return { ...normalised, source: "engine" };
  } catch { return { metrics: {}, source: "fallback" }; }
}

// ── seedWbahApiProfile ─────────────────────────────────────────────────────────
// Seeds a workspace_api_profiles row for the Webuyanyhouse workspace.
// auth_strategy is "enterprise_integration" — tokens loaded from
// enterprise_integrations at runtime via getWbahTokens().
// Idempotent — safe to call multiple times.

export async function seedWbahApiProfile(workspaceId: string): Promise<{ ok: boolean; id?: string; message: string }> {
  const sb = supabaseAdmin as any;

  const { data: existing } = await sb
    .from("workspace_api_profiles")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("data_source_key", "webuyanyhouse_api")
    .maybeSingle();

  if (existing) return { ok: true, id: existing.id, message: "Profile already exists" };

  const { data: connection } = await sb
    .from("client_api_connections")
    .select("id")
    .eq("name", "Webuyanyhouse")
    .maybeSingle();

  const moduleMappings: Record<string, string> = {};
  if (connection?.id) {
    const { data: mappings } = await sb
      .from("client_api_endpoint_mappings")
      .select("id, module_key")
      .eq("client_api_connection_id", connection.id);
    for (const m of mappings ?? []) {
      moduleMappings[m.module_key] = m.id;
    }
  }

  const { data: profile, error } = await sb
    .from("workspace_api_profiles")
    .insert({
      workspace_id:        workspaceId,
      data_source_key:     "webuyanyhouse_api",
      display_name:        "Webuyanyhouse API",
      connection_id:       connection?.id ?? null,
      module_mappings:     moduleMappings,
      auth_strategy:       "enterprise_integration",
      pagination_strategy: "page",
      engine_config: {
        base_url:          "https://api2.webespoke.com",
        timeout_ms:        30000,
        retry_count:       3,
        rate_limit_rps:    10,
        page_size:         50,
        notes:             "Auth from enterprise_integrations — tokens loaded at runtime via getWbahTokens()",
      },
      is_active: true,
    })
    .select("id")
    .single();

  if (error) return { ok: false, message: error.message };
  return { ok: true, id: profile?.id, message: "WBAH API profile seeded" };
}

// ── getEngineStatus ────────────────────────────────────────────────────────────

export async function getEngineStatus(workspaceId?: string): Promise<{
  profiles:   Array<{
    id: string; displayName: string; dataSourceKey: string; workspaceId: string;
    isActive: boolean; authStrategy: string; paginationStrategy: string;
    moduleMappingCount: number; updatedAt: string;
  }>;
  moduleLogs: Array<{
    workspaceId: string; dataSourceKey: string; moduleKey: string;
    lastRun: string; lastRecordCount: number | null; lastLatencyMs: number | null;
    lastStatus: number | null; hasError: boolean; lastError: string | null;
  }>;
}> {
  const sb = supabaseAdmin as any;

  let profilesQuery = sb
    .from("workspace_api_profiles")
    .select("id, display_name, data_source_key, workspace_id, is_active, auth_strategy, pagination_strategy, module_mappings, updated_at")
    .order("created_at", { ascending: true });
  if (workspaceId) profilesQuery = profilesQuery.eq("workspace_id", workspaceId);
  const { data: profiles } = await profilesQuery;

  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: recentLogs } = await sb
    .from("api_engine_logs")
    .select("workspace_id, data_source_key, module_key, requested_at, record_count, latency_ms, status_code, error_msg")
    .gte("requested_at", cutoff)
    .order("requested_at", { ascending: false })
    .limit(500);

  const logMap = new Map<string, any>();
  for (const log of recentLogs ?? []) {
    const key = `${log.workspace_id}:${log.data_source_key}:${log.module_key}`;
    if (!logMap.has(key)) logMap.set(key, log);
  }

  return {
    profiles: (profiles ?? []).map((p: any) => ({
      id:                  p.id,
      displayName:         p.display_name,
      dataSourceKey:       p.data_source_key,
      workspaceId:         p.workspace_id,
      isActive:            p.is_active,
      authStrategy:        p.auth_strategy,
      paginationStrategy:  p.pagination_strategy,
      moduleMappingCount:  Object.keys(p.module_mappings ?? {}).length,
      updatedAt:           p.updated_at,
    })),
    moduleLogs: Array.from(logMap.values()).map(l => ({
      workspaceId:     l.workspace_id,
      dataSourceKey:   l.data_source_key,
      moduleKey:       l.module_key,
      lastRun:         l.requested_at,
      lastRecordCount: l.record_count ?? null,
      lastLatencyMs:   l.latency_ms ?? null,
      lastStatus:      l.status_code ?? null,
      hasError:        !!l.error_msg,
      lastError:       l.error_msg ?? null,
    })),
  };
}
