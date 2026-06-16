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
          const [{ results, error }, blogTick] = await Promise.all([
            runCampaignTick(),
            runBlogDraftTick(),
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
        } catch (e: any) {
          console.error("[campaign-scheduler] unexpected error:", e?.message ?? e);
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
