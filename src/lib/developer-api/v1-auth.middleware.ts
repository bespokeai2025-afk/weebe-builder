/**
 * WEBEE Developer API v1 — Authentication & Rate Limiting Middleware
 *
 * Validates Bearer tokens from workspace_api_tokens.
 * Enforces permission scopes and rate limits (60 req/min default).
 */
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "node:crypto";

export type ApiPermission =
  | "leads:read"  | "leads:write"
  | "calls:read"  | "calls:trigger"
  | "agents:read"
  | "campaigns:trigger"
  | "knowledge:write"
  | "webhooks:manage"
  | "*";

export interface AuthenticatedApiRequest {
  workspaceId: string;
  tokenId:     string;
  permissions: ApiPermission[];
}

const SUPABASE_URL  = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const RATE_LIMIT    = 60; // requests per minute

function adminSb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function sha256(raw: string): string {
  return createHmac("sha256", "").update(raw).digest("hex");
}

// Simple HMAC using the token hash as key — avoids storing raw token
function hashToken(token: string): string {
  const { createHash } = require("node:crypto");
  return createHash("sha256").update(token).digest("hex");
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

  if (requiredPermission) {
    const hasPermission =
      permissions.includes("*") || permissions.includes(requiredPermission);
    if (!hasPermission) {
      return err(403, `API key missing required permission: ${requiredPermission}`);
    }
  }

  // Rate limiting — count requests in current minute window
  const windowStart = new Date();
  windowStart.setSeconds(0, 0);
  const windowIso = windowStart.toISOString();

  const { data: rateRow } = await sb
    .from("api_rate_limit_log")
    .select("request_count")
    .eq("token_id", tokenRow.id)
    .eq("window_start", windowIso)
    .maybeSingle();

  const currentCount = rateRow?.request_count ?? 0;
  if (currentCount >= RATE_LIMIT) {
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
            "X-RateLimit-Reset":     String(Math.ceil(windowStart.getTime() / 1000) + 60),
          },
        },
      ),
    };
  }

  // Upsert rate limit counter (fire and forget)
  sb.from("api_rate_limit_log")
    .upsert(
      { token_id: tokenRow.id, workspace_id: tokenRow.workspace_id, window_start: windowIso, request_count: currentCount + 1 },
      { onConflict: "token_id,window_start" },
    )
    .then(() => {});

  // Update last_used_at (fire and forget)
  sb.from("workspace_api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", tokenRow.id)
    .then(() => {});

  return {
    ok: true,
    ctx: {
      workspaceId: tokenRow.workspace_id,
      tokenId:     tokenRow.id,
      permissions,
    },
  };
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
