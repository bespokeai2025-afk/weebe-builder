/**
 * POST /api/public/campaign-executor
 *
 * Unified background-tick handler. Runs in parallel:
 *   • runCampaignTick()    — call-scheduling campaigns
 *   • runBlogDraftTick()   — scheduled blog content generation
 *   • runCMOAnalysisTick() — AI-driven CMO marketing analysis
 *   • runAdsSyncTick()     — ad campaign metrics (Meta, Google, TikTok, LinkedIn)
 *
 * Secured with the Supabase service-role key passed as a Bearer token.
 *
 * Intended to be called by a pg_cron job every 5 minutes:
 *   SELECT cron.schedule(
 *     'execute-call-campaigns',
 *     '*\/5 * * * *',
 *     $$SELECT public.trigger_campaign_executor()$$
 *   );
 *
 * Ads data is also synced on a dedicated 15-minute cron via:
 *   POST /api/public/ads-sync  (x-cron-secret auth, see 20260722000000_ads_sync_cron.sql)
 *
 * Manual trigger (for testing):
 *   curl -X POST https://<host>/api/public/campaign-executor \
 *     -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>"
 */
import { createFileRoute } from "@tanstack/react-router";
import { runCampaignTick } from "@/lib/campaign-scheduler/executor";
import { runBlogDraftTick } from "@/lib/growthmind/blog-draft-tick";
import { runCMOAnalysisTick } from "@/lib/growthmind/cmo-analysis-tick";
import { runAdsSyncTick } from "@/lib/growthmind/growthmind.ads-sync-tick";

export const Route = createFileRoute("/api/public/campaign-executor")({
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
          const [campaignTick, blogTick, cmoTick, adsTick] = await Promise.all([
            runCampaignTick(),
            runBlogDraftTick(),
            runCMOAnalysisTick(),
            runAdsSyncTick(),
          ]);

          if (campaignTick.error) {
            console.error("[campaign-executor] tick error:", campaignTick.error);
            return Response.json({ error: campaignTick.error }, { status: 500 });
          }

          const due = campaignTick.results.filter((r) => !r.skipped);
          const skipped = campaignTick.results.filter((r) => r.skipped);
          if (blogTick.queued.length) {
            console.log(
              `[blog-draft-tick] queued=${blogTick.queued.length} skipped=${blogTick.skipped.length} failed=${blogTick.failed.length}`,
            );
          }
          if (cmoTick.ran.length) {
            console.log(
              `[cmo-analysis-tick] ran=${cmoTick.ran.length} skipped=${cmoTick.skipped.length} failed=${cmoTick.failed.length}`,
            );
          }
          if (adsTick.synced > 0 || adsTick.errors > 0) {
            console.log(
              `[ads-sync-tick] synced=${adsTick.synced} errors=${adsTick.errors} skipped=${adsTick.skipped}`,
            );
          }
          console.log(
            `[campaign-executor] ran=${due.length} skipped=${skipped.length}`,
          );

          return Response.json({
            ran: due.length,
            skipped: skipped.length,
            results: campaignTick.results,
            blogDrafts: { queued: blogTick.queued.length, skipped: blogTick.skipped.length, failed: blogTick.failed.length },
            cmoAnalysis: { ran: cmoTick.ran.length, skipped: cmoTick.skipped.length, failed: cmoTick.failed.length },
            adsSync: { synced: adsTick.synced, errors: adsTick.errors, skipped: adsTick.skipped },
          });
        } catch (e: any) {
          console.error("[campaign-executor] unhandled error:", e);
          return Response.json(
            { error: e?.message ?? "Internal error" },
            { status: 500 },
          );
        }
      },
    },
  },
});
