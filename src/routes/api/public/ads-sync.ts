// POST /api/public/ads-sync  — triggered by pg_cron every 15 min in production
// GET  /api/public/ads-sync  — returns last N sync log entries (health check)
//
// Both verbs require the x-cron-secret header to match process.env.CRON_SECRET.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { runAdsSyncTick } from "@/lib/growthmind/growthmind.ads-sync-tick";

function cronAuth(request: Request): Response | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return new Response(JSON.stringify({ error: "CRON_SECRET not configured on this server" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  const secret = request.headers.get("x-cron-secret");
  if (secret !== cronSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return null;
}

export const Route = createFileRoute("/api/public/ads-sync")({
  server: {
    handlers: {
      // ── Health / verification endpoint ──────────────────────────────────────
      // curl -H "x-cron-secret: $CRON_SECRET" https://webeebuilder.com/api/public/ads-sync
      // Returns the last 20 growthmind_ad_sync_log rows so you can confirm the
      // cron fired and at what cadence.
      GET: async ({ request }) => {
        const authErr = cronAuth(request);
        if (authErr) return authErr;

        try {
          const sb = createClient(
            process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
            process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
            { auth: { autoRefreshToken: false, persistSession: false } },
          );

          const { data: logs, error } = await sb
            .from("growthmind_ad_sync_log")
            .select("id, workspace_id, platform, campaigns_synced, spend_total, status, error_message, synced_at")
            .order("synced_at", { ascending: false })
            .limit(20);

          if (error) {
            return new Response(JSON.stringify({ ok: false, error: error.message }), {
              status: 500,
              headers: { "content-type": "application/json" },
            });
          }

          const summary = {
            ok: true,
            checked_at: new Date().toISOString(),
            total_entries: logs?.length ?? 0,
            last_sync: logs?.[0]?.synced_at ?? null,
            platforms_in_last_20: [...new Set((logs ?? []).map((r: any) => r.platform))],
            recent_errors: (logs ?? []).filter((r: any) => r.status === "error").length,
            entries: logs ?? [],
          };

          return new Response(JSON.stringify(summary, null, 2), {
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

      // ── Cron trigger endpoint ───────────────────────────────────────────────
      // Called by pg_cron via trigger_ads_sync() every 15 minutes.
      POST: async ({ request }) => {
        const authErr = cronAuth(request);
        if (authErr) return authErr;

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
