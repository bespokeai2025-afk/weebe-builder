/**
 * POST /api/public/stale-call-sweep
 *
 * Closes out native-engine calls stuck in `in_progress` because their
 * `call_ended` webhook was never delivered — see stale-call-sweep.server.ts
 * for why that happens and why the transcript can't be recovered at this point.
 *
 * Secured with the Supabase service-role key as a Bearer token.
 * Call from pg_cron every 10 minutes:
 *
 *   SELECT cron.schedule(
 *     'stale-call-sweep',
 *     '*\/10 * * * *',
 *     $$SELECT public.trigger_stale_call_sweep()$$
 *   );
 *
 * Manual trigger:
 *   curl -X POST https://<host>/api/public/stale-call-sweep \
 *     -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>"
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sweepStaleNativeCalls } from "@/lib/voice/lifecycle/stale-call-sweep.server";

export const Route = createFileRoute("/api/public/stale-call-sweep")({
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
          const result = await sweepStaleNativeCalls(supabaseAdmin as any);

          if (result.closed > 0) {
            console.log(`[stale-call-sweep] closed=${result.closed} calls=${result.callIds.join(",")}`);
          }

          return Response.json(result);
        } catch (e: any) {
          console.error("[stale-call-sweep] unhandled error:", e);
          return Response.json({ error: e?.message ?? "Internal error" }, { status: 500 });
        }
      },
    },
  },
});
