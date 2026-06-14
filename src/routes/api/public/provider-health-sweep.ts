/**
 * POST /api/public/provider-health-sweep
 *
 * Runs live health checks for all non-coming_soon providers across all workspaces
 * and persists status to provider_settings.
 *
 * Secured with the Supabase service-role key as a Bearer token.
 * Call from pg_cron every 15 minutes:
 *
 *   SELECT cron.schedule(
 *     'provider-health-sweep',
 *     '*\/15 * * * *',
 *     $$SELECT public.trigger_provider_health_sweep()$$
 *   );
 *
 * Manual trigger:
 *   curl -X POST https://<host>/api/public/provider-health-sweep \
 *     -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>"
 */
import { createFileRoute } from "@tanstack/react-router";
import { runAllWorkspacesHealthChecks } from "@/lib/providers/health.server";

export const Route = createFileRoute("/api/public/provider-health-sweep")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!serviceKey) {
          return Response.json({ error: "Server misconfigured" }, { status: 500 });
        }

        const authHeader = request.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const token = authHeader.slice("Bearer ".length).trim();
        if (token !== serviceKey) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }

        try {
          const result = await runAllWorkspacesHealthChecks();

          console.log(
            `[provider-health-sweep] workspaces=${result.workspaces} checked=${result.checked} passed=${result.passed} failed=${result.failed}`,
          );

          return Response.json(result);
        } catch (e: any) {
          console.error("[provider-health-sweep] unhandled error:", e);
          return Response.json({ error: e?.message ?? "Internal error" }, { status: 500 });
        }
      },
    },
  },
});
