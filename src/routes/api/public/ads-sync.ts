// POST /api/public/ads-sync
// Called by pg_cron in production. Pulls live campaign metrics for all
// workspaces that have Meta Ads or Google Ads credentials configured.
// Secured by a shared CRON_SECRET header to prevent public abuse.
import { createFileRoute } from "@tanstack/react-router";
import { runAdsSyncTick } from "@/lib/growthmind/growthmind.ads-sync-tick";

export const Route = createFileRoute("/api/public/ads-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = request.headers.get("x-cron-secret");
        if (secret !== (process.env.CRON_SECRET ?? "")) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        try {
          const summary = await runAdsSyncTick();
          return new Response(JSON.stringify({ ok: true, ...summary }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        } catch (err: any) {
          return new Response(JSON.stringify({ ok: false, error: err?.message ?? String(err) }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});
