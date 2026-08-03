/**
 * POST /api/public/wbah-post-call-queue — process pending WBAH post-call jobs (retries).
 *
 * Auth: Bearer SUPABASE_SERVICE_ROLE_KEY or x-poller-secret: POLLER_SECRET
 *
 * Schedule with pg_cron every minute in production.
 */
import { createFileRoute } from "@tanstack/react-router";
import { runWbahPostCallQueuePoller } from "@/lib/wbah/post-call/wbah-post-call-queue.server";

export const Route = createFileRoute("/api/public/wbah-post-call-queue")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
        const pollerSecret = process.env.POLLER_SECRET ?? "";
        const authHeader = request.headers.get("Authorization") ?? "";
        const secretHdr = request.headers.get("x-poller-secret") ?? "";
        const byBearer = serviceKey && authHeader === `Bearer ${serviceKey}`;
        const bySecret = pollerSecret && secretHdr === pollerSecret;
        if (!byBearer && !bySecret) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        try {
          const result = await runWbahPostCallQueuePoller();
          if (result.checked > 0) {
            console.log(
              `[wbah-post-call-queue] checked=${result.checked} processed=${result.processed} failed=${result.failed}`,
            );
          }
          return Response.json({ ok: true, ...result });
        } catch (e) {
          console.error("[wbah-post-call-queue]", e);
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
    },
  },
});
