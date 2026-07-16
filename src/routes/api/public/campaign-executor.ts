/**
 * POST /api/public/campaign-executor
 *
 * Unified background-tick handler. Runs in parallel:
 *   • runCampaignTick()      — call-scheduling campaigns
 *   • runBlogDraftTick()     — scheduled blog content generation
 *   • runCMOAnalysisTick()   — AI-driven CMO marketing analysis
 *   • runAdsSyncTick()       — ad campaign metrics (Meta, Google, TikTok, LinkedIn)
 *   • runAccountsMindTick()  — client costing snapshots, finance alerts, HiveMind + GrowthMind reporting
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
import { runAccountsMindTick } from "@/lib/accountsmind/executor";
import { runProactiveTick } from "@/lib/hivemind/proactive-engine";

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
          const [campaignTick, blogTick, cmoTick, adsTick, accountsTick, proactiveTick] = await Promise.all([
            runCampaignTick(),
            runBlogDraftTick(),
            runCMOAnalysisTick(),
            runAdsSyncTick(),
            runAccountsMindTick(),
            runProactiveTick(),
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
          if (accountsTick.scanned > 0) {
            console.log(
              `[accountsmind-tick] scanned=${accountsTick.scanned} updated=${accountsTick.updated}` +
              ` alerts=${accountsTick.alertsGenerated} hivemind_tasks=${accountsTick.hivemindTasksPosted}` +
              (accountsTick.failed.length ? ` failed=${accountsTick.failed.length}` : ""),
            );
          }

          // Daily AccountsMind metric snapshots (once per workspace per UTC
          // day — powers trend/progress widget history). Best-effort.
          try {
            const { runMetricSnapshotSweepServer } = await import(
              "@/lib/accountsmind/accountsmind-config.server"
            );
            const sweep = await runMetricSnapshotSweepServer();
            if (sweep.snapshotted > 0 || sweep.pruned > 0) {
              console.log(
                `[accountsmind-snapshots] workspaces=${sweep.workspaces} snapshotted=${sweep.snapshotted} skipped=${sweep.skipped} pruned=${sweep.pruned}`,
              );
            }
          } catch (snapErr: any) {
            console.warn("[accountsmind-snapshots] sweep failed:", snapErr?.message ?? snapErr);
          }

          // Notification email digests (hourly/daily/weekly batching).
          // Best-effort — never blocks the tick.
          try {
            const { createClient } = await import("@supabase/supabase-js");
            const { processNotificationDigests } = await import(
              "@/lib/notifications/notification-engine.shared"
            );
            const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            if (url && serviceKey) {
              const digestSb = createClient(url, serviceKey);
              const digests = await processNotificationDigests(digestSb);
              if (digests.sent > 0 || digests.failed > 0) {
                console.log(`[notify-digests] sent=${digests.sent} failed=${digests.failed}`);
              }
            }
          } catch (digestErr: any) {
            console.warn("[notify-digests] failed:", digestErr?.message ?? digestErr);
          }

          // Daily log-table retention prune (retell_webhook_events,
          // hivemind_events, provider_usage_log, growthmind_generation_logs,
          // growthmind_ad_webhook_events). Once per UTC day; best-effort —
          // never blocks the tick.
          try {
            const { runLogRetentionSweepServer } = await import(
              "@/lib/maintenance/log-retention.server"
            );
            const retention = await runLogRetentionSweepServer();
            const tables = Object.keys(retention.pruned);
            if (tables.length > 0) {
              console.log(
                `[log-retention] ${tables.map((t) => `${t}=${retention.pruned[t]}`).join(" ")}`,
              );
            }
          } catch (retErr: any) {
            console.warn("[log-retention] sweep failed:", retErr?.message ?? retErr);
          }
          // WBAH dialler campaign start/finish reports. Best-effort — never
          // blocks the tick, never opens a WeeBespoke session.
          try {
            const { runWbahCampaignRunTick } = await import(
              "@/lib/integrations/webespokeEnterprise/wbah-campaign-reporting.server"
            );
            const wbahRuns = await runWbahCampaignRunTick();
            if (wbahRuns.started > 0 || wbahRuns.finished > 0 || wbahRuns.errors > 0) {
              console.log(
                `[wbah-campaign-runs] started=${wbahRuns.started} finished=${wbahRuns.finished} watching=${wbahRuns.watching} errors=${wbahRuns.errors}`,
              );
            }
          } catch (wbahErr: any) {
            console.warn("[wbah-campaign-runs] tick failed:", wbahErr?.message ?? wbahErr);
          }

          // Scheduled analytics reports (once-per-tick due check). Best-effort —
          // never blocks the tick.
          try {
            const { processAnalyticsReportSchedules } = await import(
              "@/lib/analytics-hub/report-schedule-tick"
            );
            const sched = await processAnalyticsReportSchedules();
            if (sched.ran > 0 || sched.failed > 0) {
              console.log(
                `[analytics-schedules] scanned=${sched.scanned} ran=${sched.ran} failed=${sched.failed}`,
              );
            }
          } catch (schedErr: any) {
            console.warn("[analytics-schedules] sweep failed:", schedErr?.message ?? schedErr);
          }

          console.log(
            `[campaign-executor] ran=${due.length} skipped=${skipped.length}`,
          );

          if (proactiveTick.dnaRefreshed > 0 || proactiveTick.briefingsGenerated > 0) {
            console.log(
              `[proactive-engine] ws=${proactiveTick.workspacesScanned} dna=${proactiveTick.dnaRefreshed} briefings=${proactiveTick.briefingsGenerated} errors=${proactiveTick.errors}`,
            );
          }

          return Response.json({
            ran: due.length,
            skipped: skipped.length,
            results: campaignTick.results,
            blogDrafts: { queued: blogTick.queued.length, skipped: blogTick.skipped.length, failed: blogTick.failed.length },
            cmoAnalysis: { ran: cmoTick.ran.length, skipped: cmoTick.skipped.length, failed: cmoTick.failed.length },
            adsSync: { synced: adsTick.synced, errors: adsTick.errors, skipped: adsTick.skipped },
            accountsMind: { scanned: accountsTick.scanned, updated: accountsTick.updated, alerts: accountsTick.alertsGenerated, hivemindTasks: accountsTick.hivemindTasksPosted, failed: accountsTick.failed.length },
            proactiveEngine: { workspacesScanned: proactiveTick.workspacesScanned, dnaRefreshed: proactiveTick.dnaRefreshed, briefingsGenerated: proactiveTick.briefingsGenerated, errors: proactiveTick.errors },
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
