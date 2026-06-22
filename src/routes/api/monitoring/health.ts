/**
 * GET /api/monitoring/health
 *
 * Public health check endpoint.
 * Returns platform status, environment, and basic system info.
 * Safe to call from uptime monitors (UptimeRobot, Betterstack, etc.)
 *
 * No authentication required.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/monitoring/health")({
  server: {
    handlers: {
      GET: async () => {
        const start = Date.now();
        const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

        // DB check
        try {
          const sb = createClient(
            process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
            process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
            { auth: { autoRefreshToken: false, persistSession: false } },
          );
          const t0 = Date.now();
          const { error } = await sb.from("workspaces").select("id").limit(1);
          checks.database = { ok: !error, latencyMs: Date.now() - t0, error: error?.message };
        } catch (e: any) {
          checks.database = { ok: false, error: e?.message ?? "Unknown" };
        }

        // Env check — match the variable names the app actually reads
        const hasUrl = !!(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL);
        const hasPublishableKey = !!(
          process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY
        );
        const missingEnv = [
          ...(hasUrl ? [] : ["VITE_SUPABASE_URL"]),
          ...(hasPublishableKey ? [] : ["VITE_SUPABASE_PUBLISHABLE_KEY"]),
          ...(process.env.SUPABASE_SERVICE_ROLE_KEY ? [] : ["SUPABASE_SERVICE_ROLE_KEY"]),
        ];
        checks.environment = { ok: missingEnv.length === 0, error: missingEnv.length > 0 ? `Missing: ${missingEnv.join(", ")}` : undefined };

        const allOk = Object.values(checks).every(c => c.ok);
        const totalMs = Date.now() - start;

        return Response.json(
          {
            status: allOk ? "ok" : "degraded",
            timestamp: new Date().toISOString(),
            uptimeMs: process.uptime ? Math.round(process.uptime() * 1000) : null,
            responseMs: totalMs,
            checks,
            version: process.env.npm_package_version ?? "unknown",
          },
          { status: allOk ? 200 : 503 },
        );
      },
    },
  },
});
