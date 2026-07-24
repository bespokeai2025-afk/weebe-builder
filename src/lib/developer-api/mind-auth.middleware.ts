/**
 * WEBEE Mind API — dual authentication middleware.
 *
 * Mind endpoints under /api/v1/minds/* accept TWO credential types:
 *
 *  1. Supabase user access token (first-party mobile clients).
 *     - Bearer <supabase JWT> validated via auth.getClaims.
 *     - Workspace comes from the `X-Workspace-Id` header when provided
 *       (membership verified fail-closed via resolvePermissions), otherwise
 *       the user's default workspace is resolved exactly like the web app.
 *     - A user-JWT-bound Supabase client is returned so RLS applies to every
 *       read/write, matching the web server-function path 1:1.
 *     - Rate limited 60 req/min per user (Redis; in-process fallback).
 *
 *  2. Workspace HMAC API key (existing Developer API tokens).
 *     - Delegates to authenticateV1Request with the required `minds:*`
 *       permission. These are workspace-level integrations with NO user
 *       identity, so user-scoped endpoints must pass `requireUser: true`
 *       and will refuse HMAC keys with a clear 403.
 */
import { createClient } from "@supabase/supabase-js";
import { redisRateLimit } from "@/lib/cache/redis.server";
import {
  authenticateV1Request,
  type ApiPermission,
} from "./v1-auth.middleware";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "";
const RATE_LIMIT = 60; // requests per minute per user

export interface MindApiContext {
  authKind: "user_token" | "api_key";
  workspaceId: string;
  /** Present only for user tokens. */
  userId: string | null;
  /**
   * Supabase client to use for data access.
   * - user_token: bound to the user's JWT (RLS enforced, same as web).
   * - api_key:    null — routes must use the service-role client with
   *               explicit workspace scoping (existing v1 pattern).
   */
  supabase: any | null;
}

type MindAuthResult =
  | { ok: true; ctx: MindApiContext }
  | { ok: false; response: Response };

function jsonError(status: number, message: string): MindAuthResult {
  return {
    ok: false,
    response: new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  };
}

// In-process rate-limit fallback (per instance) used when Redis is down.
const localWindows = new Map<string, { windowMin: string; count: number }>();
function localRateLimit(key: string): boolean {
  const windowMin = new Date().toISOString().slice(0, 16);
  const cur = localWindows.get(key);
  if (!cur || cur.windowMin !== windowMin) {
    localWindows.set(key, { windowMin, count: 1 });
    if (localWindows.size > 5000) {
      for (const [k, v] of localWindows) {
        if (v.windowMin !== windowMin) localWindows.delete(k);
      }
    }
    return true;
  }
  cur.count += 1;
  return cur.count <= RATE_LIMIT;
}

function looksLikeSupabaseJwt(token: string): boolean {
  // Supabase access tokens are JWTs (three base64url segments starting eyJ).
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
}

/**
 * Authenticate a Mind API request with either a Supabase user token or a
 * workspace HMAC API key.
 *
 * @param requiredPermission HMAC permission scope required when an API key
 *                           is used ("minds:read" | "minds:execute").
 * @param opts.requireUser   When true, HMAC keys are refused (403) because
 *                           the endpoint is user-scoped.
 */
export async function authenticateMindApiRequest(
  request: Request,
  requiredPermission: ApiPermission,
  opts?: { requireUser?: boolean },
): Promise<MindAuthResult> {
  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonError(
      401,
      "Missing Authorization header. Use: Authorization: Bearer <supabase access token or WEBEE API key>",
    );
  }
  const rawToken = authHeader.slice("Bearer ".length).trim();
  if (!rawToken) return jsonError(401, "Empty bearer token");

  // ── Path 1: Supabase user access token ────────────────────────────────────
  if (looksLikeSupabaseJwt(rawToken)) {
    if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
      return jsonError(500, "Server auth configuration missing");
    }
    const supabase = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${rawToken}` } },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    let userId: string;
    try {
      const { data, error } = await supabase.auth.getClaims(rawToken);
      if (error || !data?.claims?.sub) {
        return jsonError(401, "Invalid or expired user token");
      }
      userId = data.claims.sub as string;
    } catch {
      // Malformed JWT segments make getClaims throw instead of returning
      // an error — treat exactly like any other bad credential.
      return jsonError(401, "Invalid or expired user token");
    }

    // Rate limit per user (Redis preferred; local fallback so limits are
    // never skipped entirely).
    const windowMin = new Date().toISOString().slice(0, 16);
    const rlKey = `webee:v1:rl:user:${userId}:${windowMin}`;
    const rl = await redisRateLimit(rlKey, RATE_LIMIT);
    const allowed = rl.redisUsed ? rl.allowed : localRateLimit(`u:${userId}`);
    if (!allowed) {
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
              "X-RateLimit-Limit": String(RATE_LIMIT),
              "X-RateLimit-Remaining": "0",
            },
          },
        ),
      };
    }

    // Workspace resolution — explicit header (membership verified,
    // fail closed) or the user's default workspace.
    const headerWs = (request.headers.get("X-Workspace-Id") ?? "").trim();
    let workspaceId: string | null = null;
    if (headerWs) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(headerWs)) {
        return jsonError(400, "Invalid X-Workspace-Id header");
      }
      const { resolvePermissions } = await import(
        "@/lib/permissions/permissions.server"
      );
      const perms = await resolvePermissions(headerWs, userId);
      if (!perms.isMember) {
        return jsonError(403, "Not a member of the requested workspace");
      }
      workspaceId = headerWs;
    } else {
      const { resolveWorkspaceIdForUser } = await import(
        "@/lib/workspace/resolve-workspace.server"
      );
      workspaceId = (await resolveWorkspaceIdForUser(supabase as any, userId, undefined)) ?? null;
    }
    if (!workspaceId) {
      return jsonError(403, "No accessible workspace for this user");
    }

    return {
      ok: true,
      ctx: { authKind: "user_token", workspaceId, userId, supabase },
    };
  }

  // ── Path 2: workspace HMAC API key (existing Developer API tokens) ───────
  if (opts?.requireUser) {
    return jsonError(
      403,
      "This endpoint is user-scoped and requires a Supabase user access token; workspace API keys are not accepted here.",
    );
  }
  const hmac = await authenticateV1Request(request, requiredPermission);
  if (!hmac.ok) return hmac;
  return {
    ok: true,
    ctx: {
      authKind: "api_key",
      workspaceId: hmac.ctx.workspaceId,
      userId: null,
      supabase: null,
    },
  };
}
