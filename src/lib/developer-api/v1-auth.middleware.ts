/**
 * WEBEE Developer API v1 — Authentication & Rate Limiting Middleware
 *
 * Validates Bearer tokens from workspace_api_tokens.
 * Enforces permission scopes and rate limits (60 req/min default).
 *
 * Performance layer:
 *   - Token validation results cached in Redis for 60 s (cache miss → Supabase)
 *   - Rate limiting uses Redis atomic INCR + EXPIREAT when Redis is available
 *   - When Redis is unavailable, rate limiting falls back to api_rate_limit_log DB table
 *   - api_rate_limit_log table kept intact for the fallback path
 */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { cacheGet, cacheSet, cacheDel, redisRateLimit } from "@/lib/cache/redis.server";

export type ApiPermission =
  | "leads:read"    | "leads:write"
  | "calls:read"    | "calls:trigger"  | "calls:analytics"
  | "agents:read"   | "agents:deploy"  | "agents:archive"
  | "contacts:read" | "contacts:write"
  | "bookings:read" | "bookings:write"
  | "analytics:read"
  | "campaigns:trigger" | "campaigns:read"
  | "knowledge:write"
  | "webhooks:manage"
  | "billing:read"
  | "growthmind:read"
  | "minds:read"
  | "minds:execute"
  | "*";

export interface AuthenticatedApiRequest {
  workspaceId: string;
  tokenId:     string;
  permissions: ApiPermission[];
}

interface CachedTokenData {
  workspaceId: string;
  tokenId:     string;
  permissions: ApiPermission[];
}

const SUPABASE_URL  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const RATE_LIMIT    = 60; // requests per minute
const TOKEN_CACHE_TTL = 60; // seconds

function adminSb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenCacheKey(tokenHash: string): string {
  return `webee:v1:token:${tokenHash}`;
}

function rateLimitCacheKey(tokenId: string): string {
  const windowStart = new Date();
  windowStart.setSeconds(0, 0);
  const windowMin = windowStart.toISOString().slice(0, 16); // "2026-06-19T12:34"
  return `webee:v1:rl:${tokenId}:${windowMin}`;
}

/**
 * DB-based rate limit fallback — used when Redis is unavailable.
 * Reads and upserts into api_rate_limit_log (original behaviour).
 */
async function dbRateLimit(
  sb: ReturnType<typeof adminSb>,
  tokenId: string,
  workspaceId: string,
): Promise<{ count: number; allowed: boolean; windowExpireAt: number }> {
  const windowStart = new Date();
  windowStart.setSeconds(0, 0);
  const windowIso = windowStart.toISOString();
  const windowExpireAt = Math.ceil(windowStart.getTime() / 1000) + 60;

  const { data: rateRow } = await sb
    .from("api_rate_limit_log")
    .select("request_count")
    .eq("token_id", tokenId)
    .eq("window_start", windowIso)
    .maybeSingle();

  const currentCount = rateRow?.request_count ?? 0;
  const allowed = currentCount < RATE_LIMIT;

  if (allowed) {
    // Upsert counter (fire and forget)
    sb.from("api_rate_limit_log")
      .upsert(
        { token_id: tokenId, workspace_id: workspaceId, window_start: windowIso, request_count: currentCount + 1 },
        { onConflict: "token_id,window_start" },
      )
      .then(() => {});
  }

  return { count: currentCount + (allowed ? 1 : 0), allowed, windowExpireAt };
}

export async function authenticateV1Request(
  request: Request,
  requiredPermission?: ApiPermission,
): Promise<{ ok: true; ctx: AuthenticatedApiRequest } | { ok: false; response: Response }> {
  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return err(401, "Missing Authorization header. Use: Authorization: Bearer <WEBEE_API_KEY>");
  }

  const rawToken = authHeader.slice("Bearer ".length).trim();
  if (!rawToken) return err(401, "Empty API key");

  const tokenHash = hashToken(rawToken);
  const sb = adminSb();

  // ── 1. Token validation — Redis first, Supabase on miss ──────────────────
  const cacheKey = tokenCacheKey(tokenHash);
  let tokenData = await cacheGet<CachedTokenData>(cacheKey);

  if (!tokenData) {
    const { data: tokenRow } = await sb
      .from("workspace_api_tokens")
      .select("id, workspace_id, permissions_json, revoked_at, expires_at, last_used_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!tokenRow) return err(401, "Invalid API key");
    if (tokenRow.revoked_at) return err(401, "API key has been revoked");
    if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) {
      return err(401, "API key has expired");
    }

    const permissions: ApiPermission[] = tokenRow.permissions_json ?? ["*"];
    tokenData = {
      workspaceId: tokenRow.workspace_id,
      tokenId:     tokenRow.id,
      permissions,
    };

    // Cache successful validation
    await cacheSet(cacheKey, TOKEN_CACHE_TTL, tokenData);

    // Update last_used_at (fire and forget)
    adminSb()
      .from("workspace_api_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", tokenRow.id)
      .then(() => {});
  }

  if (requiredPermission) {
    const hasPermission =
      tokenData.permissions.includes("*") || tokenData.permissions.includes(requiredPermission);
    if (!hasPermission) {
      return err(403, `API key missing required permission: ${requiredPermission}`);
    }
  }

  // ── 2. Rate limiting — Redis preferred; DB fallback when Redis is down ────
  const rlKey = rateLimitCacheKey(tokenData.tokenId);
  const redisResult = await redisRateLimit(rlKey, RATE_LIMIT);

  let rateLimitResult: { count: number; allowed: boolean; windowExpireAt: number };

  if (redisResult.redisUsed) {
    rateLimitResult = redisResult;
  } else {
    // Redis unavailable — fall back to DB enforcement so limits are never skipped
    console.warn("[v1-auth] Redis unavailable, falling back to DB rate limiting");
    rateLimitResult = await dbRateLimit(sb, tokenData.tokenId, tokenData.workspaceId);
  }

  if (!rateLimitResult.allowed) {
    const retryAfter = 60 - new Date().getSeconds();
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Rate limit exceeded", retry_after_seconds: retryAfter }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(retryAfter),
            "X-RateLimit-Limit":     String(RATE_LIMIT),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset":     String(rateLimitResult.windowExpireAt),
          },
        },
      ),
    };
  }

  return {
    ok: true,
    ctx: {
      workspaceId: tokenData.workspaceId,
      tokenId:     tokenData.tokenId,
      permissions: tokenData.permissions,
    },
  };
}

/**
 * Call this when a token is revoked so its cached validation is immediately invalidated.
 */
export async function invalidateTokenCache(rawTokenOrHash: string): Promise<void> {
  const hash = rawTokenOrHash.length === 64 && /^[0-9a-f]+$/.test(rawTokenOrHash)
    ? rawTokenOrHash
    : hashToken(rawTokenOrHash);
  await cacheDel(tokenCacheKey(hash));
}

function err(status: number, message: string): { ok: false; response: Response } {
  return {
    ok: false,
    response: new Response(
      JSON.stringify({ error: message }),
      { status, headers: { "Content-Type": "application/json" } },
    ),
  };
}

export function jsonOk(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function jsonErr(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
