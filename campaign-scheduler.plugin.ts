/**
 * Vite dev-server plugin: Campaign Scheduler
 *
 * Triggers Retell outbound calls for active __sched_v1__ call-scheduling
 * campaigns. Runs a tick every 5 minutes while the dev server is live.
 *
 * In production the same logic is invoked via the HTTP endpoint
 *   POST /api/public/campaign-executor
 * which is called by a pg_cron job every 5 minutes.
 */
import type { Plugin } from "vite";
import { runCampaignTick } from "./src/lib/campaign-scheduler/executor";
import { runBlogDraftTick } from "./src/lib/growthmind/blog-draft-tick";
import { runCMOAnalysisTick } from "./src/lib/growthmind/cmo-analysis-tick";
import { runGscSyncTick } from "./src/lib/growthmind/gsc-sync-core";
import { runClaritySyncTick } from "./src/lib/growthmind/clarity-sync-core";

const TICK_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_DELAY_MS = 45_000;

export function campaignSchedulerPlugin(): Plugin {
  return {
    name: "campaign-scheduler",
    configureServer(server) {
      let intervalId: ReturnType<typeof setInterval> | null = null;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      async function tick() {
        try {
          const [{ results, error }, blogTick, cmoTick] = await Promise.all([
            runCampaignTick(),
            runBlogDraftTick(),
            runCMOAnalysisTick(),
          ]);

          if (error) {
            console.error("[campaign-scheduler] tick error:", error);
          } else {
            const due = results.filter((r) => !r.skipped);
            if (due.length) {
              console.log(
                `[campaign-scheduler] ran ${due.length} campaign(s):`,
                due.map((r) => `${r.campaignName} (placed=${r.placed} failed=${r.failed})`).join(", "),
              );
            }
          }

          if (blogTick.queued.length) {
            console.log(
              `[blog-draft-tick] queued ${blogTick.queued.length} draft(s):`,
              blogTick.queued.map((r) => r.title ?? r.workspaceId).join(", "),
            );
          }
          if (blogTick.failed.length) {
            console.warn(
              `[blog-draft-tick] ${blogTick.failed.length} failed:`,
              blogTick.failed.map((r) => `${r.workspaceId}: ${r.error}`).join(", "),
            );
          }

          if (cmoTick.ran.length) {
            console.log(
              `[cmo-analysis-tick] ran ${cmoTick.ran.length} workspace(s):`,
              cmoTick.ran.map((r) => `${r.workspaceId} (svc=${r.services} trend=${r.trends} campaigns=${r.campaigns} videos=${r.videos})`).join(", "),
            );
          }
          if (cmoTick.failed.length) {
            console.warn(
              `[cmo-analysis-tick] ${cmoTick.failed.length} failed:`,
              cmoTick.failed.map((r) => `${r.workspaceId}: ${r.error}`).join(", "),
            );
          }
        } catch (e: any) {
          console.error("[campaign-scheduler] unexpected error:", e?.message ?? e);
        }

        // Search Console incremental sync (daily per workspace; the tick
        // no-ops until next_sync_at is due). Best-effort.
        try {
          const gsc = await runGscSyncTick();
          if (gsc.ran.length || gsc.failed.length) {
            console.log(
              `[gsc-sync] ran=${gsc.ran.length} skipped=${gsc.skipped} failed=${gsc.failed.length}` +
              (gsc.ran.length ? ` — ${gsc.ran.map((r) => `${r.workspaceId}: rows=${r.rows}${r.baselinePending ? " (baseline pending)" : ""}`).join(", ")}` : "") +
              (gsc.failed.length ? ` — errors: ${gsc.failed.map((f) => `${f.workspaceId}: ${f.error}`).join("; ")}` : ""),
            );
          }
        } catch (e: any) {
          console.warn("[gsc-sync] dev tick failed:", e?.message ?? e);
        }

        // Microsoft Clarity daily sync + Website Change Queue refresh.
        // No-ops until a workspace's last_sync is >20h old (quota: max 10
        // Clarity API requests/project/day — the tick spends 1). Best-effort.
        try {
          const clarity = await runClaritySyncTick();
          if (clarity.ran.length || clarity.failed.length) {
            console.log(
              `[clarity-sync] ran=${clarity.ran.length} skipped=${clarity.skipped} failed=${clarity.failed.length}` +
              (clarity.ran.length ? ` — ${clarity.ran.map((r) => `${r.workspaceId}: rows=${r.rows}`).join(", ")}` : "") +
              (clarity.failed.length ? ` — errors: ${clarity.failed.map((f) => `${f.workspaceId}: ${f.error}`).join("; ")}` : ""),
            );
          }
        } catch (e: any) {
          console.warn("[clarity-sync] dev tick failed:", e?.message ?? e);
        }

        // Daily Marketing Operator (mirrors the prod campaign-executor
        // endpoint). Loaded via ssrLoadModule because the module uses "@/"
        // aliases. CAS-claimed per workspace (~20h), approval-first.
        try {
          const { runMarketingOperatorTick } = (await server.ssrLoadModule(
            "/src/lib/hivemind/marketing-operator-tick.ts",
          )) as typeof import("./src/lib/hivemind/marketing-operator-tick");
          const opTick = await runMarketingOperatorTick();
          if (opTick.ran.length || opTick.failed.length) {
            console.log(
              `[marketing-operator] ran=${opTick.ran.length} skipped=${opTick.skipped} failed=${opTick.failed.length}` +
              (opTick.failed.length ? ` — errors: ${opTick.failed.map((f) => `${f.workspaceId}: ${f.error}`).join("; ")}` : ""),
            );
          }
        } catch (e: any) {
          console.warn("[marketing-operator] dev tick failed:", e?.message ?? e);
        }

        // Auto SEO blog campaign creation (mirrors the prod campaign-executor
        // endpoint). Loaded via ssrLoadModule because the module uses "@/"
        // aliases. Best-effort — approval-first by construction.
        try {
          const { runSeoCampaignTick } = (await server.ssrLoadModule(
            "/src/lib/growthmind/seo-campaign-tick.ts",
          )) as typeof import("./src/lib/growthmind/seo-campaign-tick");
          const seoTick = await runSeoCampaignTick();
          if (seoTick.created.length || seoTick.failed.length) {
            console.log(
              `[seo-campaign-tick] created=${seoTick.created.length} skipped=${seoTick.skipped.length} failed=${seoTick.failed.length}`,
            );
          }
        } catch (e: any) {
          console.warn("[seo-campaign-tick] dev tick failed:", e?.message ?? e);
        }

        // WBAH dialler campaign start/finish reports (mirrors the prod
        // campaign-executor endpoint). Loaded via ssrLoadModule because the
        // module (and its report-generator imports) use "@/" aliases that
        // plain vite-config-context imports can't resolve. Best-effort.
        try {
          const { runWbahCampaignRunTick } = (await server.ssrLoadModule(
            "/src/lib/integrations/webespokeEnterprise/wbah-campaign-reporting.server.ts",
          )) as typeof import("./src/lib/integrations/webespokeEnterprise/wbah-campaign-reporting.server");
          const wbahRuns = await runWbahCampaignRunTick();
          if (wbahRuns.started > 0 || wbahRuns.finished > 0 || wbahRuns.errors > 0) {
            console.log(
              `[wbah-campaign-runs] started=${wbahRuns.started} finished=${wbahRuns.finished} watching=${wbahRuns.watching} errors=${wbahRuns.errors}`,
            );
          }
        } catch (e: any) {
          console.warn("[wbah-campaign-runs] dev tick failed:", e?.message ?? e);
        }

        try {
          const { runWhatsappScheduledCampaignTick } = (await server.ssrLoadModule(
            "/src/lib/whatsapp/campaign-schedule-tick.server.ts",
          )) as typeof import("./src/lib/whatsapp/campaign-schedule-tick.server");
          const wa = await runWhatsappScheduledCampaignTick();
          if (wa.launched > 0 || wa.failed.length > 0) {
            console.log(
              `[whatsapp-schedule] launched=${wa.launched} failed=${wa.failed.length}` +
                (wa.failed.length
                  ? ` — ${wa.failed.map((f) => `${f.id}: ${f.error}`).join("; ")}`
                  : ""),
            );
          }
        } catch (e: any) {
          console.warn("[whatsapp-schedule] dev tick failed:", e?.message ?? e);
        }

        // GrowthMind content publishing (mirrors the prod campaign-executor
        // endpoint). Loaded via ssrLoadModule because the module uses "@/"
        // aliases. Best-effort — failed jobs retry with backoff.
        try {
          const { runContentPublishTick } = (await server.ssrLoadModule(
            "/src/lib/growthmind/meta-content-publish.server.ts",
          )) as typeof import("./src/lib/growthmind/meta-content-publish.server");
          const pub = await runContentPublishTick();
          if (pub.processed > 0) {
            console.log(`[content-publish] processed=${pub.processed} published=${pub.published}`);
          }
        } catch (e: any) {
          console.warn("[content-publish] dev tick failed:", e?.message ?? e);
        }

        // GrowthMind performance snapshots + attention scan + learning
        // analysis (mirrors the prod campaign-executor endpoint). Best-effort.
        try {
          const { runPerformanceSnapshotTick } = (await server.ssrLoadModule(
            "/src/lib/growthmind/performance-snapshots.server.ts",
          )) as typeof import("./src/lib/growthmind/performance-snapshots.server");
          const snap = await runPerformanceSnapshotTick();
          if (snap.captured > 0 || snap.errors > 0) {
            console.log(`[perf-snapshots] checked=${snap.jobsChecked} captured=${snap.captured} errors=${snap.errors}`);
          }
        } catch (e: any) {
          console.warn("[perf-snapshots] dev tick failed:", e?.message ?? e);
        }

        // HiveMind executive reconciliation (including notification-gap
        // recommendations). Each workspace job is CAS-claimed, so this is
        // safe alongside the production campaign-executor cron.
        try {
          const { runExecutiveEventsTick } = (await server.ssrLoadModule(
            "/src/lib/hivemind/executive-reconciliation.server.ts",
          )) as typeof import("./src/lib/hivemind/executive-reconciliation.server");
          const execEvents = await runExecutiveEventsTick();
          if (execEvents.jobsRun > 0 || execEvents.errors > 0) {
            console.log(
              `[exec-events] ws=${execEvents.workspacesScanned} jobs=${execEvents.jobsRun} published=${execEvents.eventsPublished} classified=${execEvents.eventsClassified} errors=${execEvents.errors}`,
            );
          }
        } catch (e: any) {
          console.warn("[exec-events] dev tick failed:", e?.message ?? e);
        }

        // SystemMind call runtime: trigger evaluation, queue processing,
        // integration-error retries, health sweep (mirrors the prod
        // campaign-executor endpoint). Loaded via ssrLoadModule because the
        // module uses "@/" aliases. Best-effort.
        try {
          const { runCallRuntimeTick } = (await server.ssrLoadModule(
            "/src/lib/systemmind/call-runtime/tick.server.ts",
          )) as typeof import("./src/lib/systemmind/call-runtime/tick.server");
          const rt = await runCallRuntimeTick();
          if (rt.enqueued > 0 || rt.claimed > 0 || rt.integrationRetries.resolved > 0) {
            console.log(
              `[call-runtime] triggers=${rt.triggersEvaluated} enqueued=${rt.enqueued} claimed=${rt.claimed} processed=${JSON.stringify(rt.processed)} crmRetries=${JSON.stringify(rt.integrationRetries)}`,
            );
          }
        } catch (e: any) {
          console.warn("[call-runtime] dev tick failed:", e?.message ?? e);
        }

        // Supabase DB health watchdog (mirrors the prod campaign-executor
        // endpoint). Loaded via ssrLoadModule so it shares module state with
        // server functions (admin banner reads the same snapshot). Best-effort.
        try {
          const { runDbHealthWatchdogTick } = (await server.ssrLoadModule(
            "/src/lib/maintenance/db-health-watchdog.server.ts",
          )) as typeof import("./src/lib/maintenance/db-health-watchdog.server");
          const watchdog = await runDbHealthWatchdogTick();
          if (watchdog.status === "unhealthy" || watchdog.alerted) {
            console.log(
              `[db-watchdog] status=${watchdog.status} alerted=${watchdog.alerted}`,
            );
          }
        } catch (e: any) {
          console.warn("[db-watchdog] dev tick failed:", e?.message ?? e);
        }
      }

      timeoutId = setTimeout(() => {
        tick();
        intervalId = setInterval(tick, TICK_INTERVAL_MS);
      }, INITIAL_DELAY_MS);

      server.httpServer?.on("close", () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (intervalId) clearInterval(intervalId);
      });

      console.log(
        `[campaign-scheduler] ready — first tick in ${INITIAL_DELAY_MS / 1000}s, then every ${TICK_INTERVAL_MS / 60000} min`,
      );
    },
  };
}
