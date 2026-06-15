/**
 * POST /api/public/video-job-poller
 *
 * Polls pending Veo 3 and Runway Gen-4 video generation jobs and writes the
 * final video URL (or error sentinel) back to growthmind_video_assets.
 *
 * Auth: Bearer <SUPABASE_SERVICE_ROLE_KEY>  OR  x-poller-secret: <POLLER_SECRET>
 *
 * ── PRODUCTION SETUP (pg_cron) ──────────────────────────────────────────────
 * Run once in Supabase SQL Editor (requires pg_cron + pg_net extensions):
 *
 *   SELECT cron.schedule(
 *     'video-job-poller',
 *     '* * * * *',
 *     $$
 *     SELECT net.http_post(
 *       url     := 'https://<YOUR-APP>.replit.app/api/public/video-job-poller',
 *       headers := jsonb_build_object(
 *                    'Content-Type',     'application/json',
 *                    'Authorization',    'Bearer ' || current_setting('app.supabase_service_key')
 *                  ),
 *       body    := '{}'::jsonb
 *     );
 *     $$
 *   );
 *
 * Manual trigger (testing):
 *   curl -X POST https://<host>/api/public/video-job-poller \
 *        -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>"
 * ────────────────────────────────────────────────────────────────────────────
 */
import { createFileRoute } from "@tanstack/react-router";
import { runVideoJobPoller } from "@/lib/growthmind/video-job-poller";

export const Route = createFileRoute("/api/public/video-job-poller")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
        const pollerSecret = process.env.POLLER_SECRET ?? "";

        const authHeader = request.headers.get("Authorization") ?? "";
        const secretHdr  = request.headers.get("x-poller-secret") ?? "";

        const byBearer = serviceKey && authHeader === `Bearer ${serviceKey}`;
        const bySecret = pollerSecret && secretHdr  === pollerSecret;

        if (!byBearer && !bySecret) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        try {
          const result = await runVideoJobPoller();
          if (result.checked > 0) {
            console.log(
              `[video-job-poller] checked=${result.checked} resolved=${result.resolved} failed=${result.failed}`,
              result.errors.length ? result.errors : "",
            );
          }
          return Response.json({ ok: true, ...result });
        } catch (e: any) {
          console.error("[video-job-poller] unhandled error:", e);
          return Response.json({ ok: false, error: e?.message ?? "Internal error" }, { status: 500 });
        }
      },

      GET: async () => {
        return Response.json({
          status:      "Video Job Poller — active",
          description: "POST with Authorization: Bearer <service_role_key> to trigger a polling cycle.",
        });
      },
    },
  },
});
