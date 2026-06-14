/**
 * POST /api/public/video-job-poller
 *
 * Polls pending Veo 3 and Runway Gen-4 video generation jobs and writes the
 * final video URL (or error sentinel) back to growthmind_video_assets.
 *
 * Secured with the Supabase service-role key as a Bearer token.
 *
 * Intended to be triggered by pg_cron every minute in production:
 *   SELECT cron.schedule(
 *     'poll-video-jobs',
 *     '* * * * *',
 *     $$SELECT public.trigger_video_job_poller()$$
 *   );
 *
 * Manual trigger (for testing):
 *   curl -X POST https://<host>/api/public/video-job-poller \
 *     -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>"
 */
import { createFileRoute } from "@tanstack/react-router";
import { runVideoJobPoller } from "@/lib/growthmind/video-job-poller";

export const Route = createFileRoute("/api/public/video-job-poller")({
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
          const result = await runVideoJobPoller();
          if (result.checked > 0) {
            console.log(
              `[video-job-poller] checked=${result.checked} resolved=${result.resolved} failed=${result.failed}`,
              result.errors.length ? result.errors : "",
            );
          }
          return Response.json(result);
        } catch (e: any) {
          console.error("[video-job-poller] unhandled error:", e);
          return Response.json({ error: e?.message ?? "Internal error" }, { status: 500 });
        }
      },
    },
  },
});
