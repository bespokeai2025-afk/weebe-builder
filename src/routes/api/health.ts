/**
 * GET /api/health
 *
 * Structured health-check endpoint. Safe for uptime monitors, load balancer
 * health checks, and post-deploy verification.
 *
 * Returns HTTP 200 with { status: "ok" } when all checks pass.
 * Returns HTTP 503 with { status: "degraded" } when any check fails.
 *
 * No authentication required.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const t0 = Date.now();
        const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

        // ── Database connectivity ──────────────────────────────────────────────
        try {
          const sb = createClient(
            process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
            process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
            { auth: { autoRefreshToken: false, persistSession: false } },
          );
          const dbT0 = Date.now();
          const { error } = await sb.from("workspaces").select("id").limit(1);
          checks.database = { ok: !error, latencyMs: Date.now() - dbT0, error: error?.message };
        } catch (e: any) {
          checks.database = { ok: false, error: e?.message ?? "connection failed" };
        }

        // ── Required runtime env vars ─────────────────────────────────────────
        const requiredEnv = [
          "SUPABASE_URL",
          "SUPABASE_SERVICE_ROLE_KEY",
          "VITE_SUPABASE_URL",
          "VITE_SUPABASE_ANON_KEY",
        ];
        const missing = requiredEnv.filter((k) => !process.env[k]);
        checks.environment = {
          ok:    missing.length === 0,
          error: missing.length > 0 ? `Missing env vars: ${missing.join(", ")}` : undefined,
        };

        const allOk    = Object.values(checks).every((c) => c.ok);
        const httpCode = allOk ? 200 : 503;

        return Response.json(
          {
            status:      allOk ? "ok" : "degraded",
            version:     process.env.npm_package_version ?? "unknown",
            commit_sha:  process.env.COMMIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? "unknown",
            environment: process.env.NODE_ENV ?? "unknown",
            uptime_s:    process.uptime ? Math.round(process.uptime()) : null,
            response_ms: Date.now() - t0,
            timestamp:   new Date().toISOString(),
            checks,
          },
          { status: httpCode },
        );
      },
    },
  },
});
