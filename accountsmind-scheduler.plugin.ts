/**
 * Vite dev-server plugin: AccountsMind Scheduler
 *
 * Runs the AccountsMind cost-scan hourly while the dev server is live.
 * For every workspace with an active billing profile it:
 *   • Computes + stores monthly cost snapshots
 *   • Generates / refreshes finance alerts
 *   • Posts critical alerts to hivemind_tasks
 *   • Posts loss-making warnings to growthmind_recommendations
 *
 * In production the same tick is included in the campaign-executor cron:
 *   POST /api/public/campaign-executor
 */
import type { Plugin } from "vite";
import { runAccountsMindTick } from "./src/lib/accountsmind/executor";

const TICK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const INITIAL_DELAY_MS = 90_000;          // 90 s — let the server fully boot first

export function accountsMindSchedulerPlugin(): Plugin {
  return {
    name: "accountsmind-scheduler",
    configureServer(server) {
      let intervalId: ReturnType<typeof setInterval> | null = null;
      let timeoutId:  ReturnType<typeof setTimeout>  | null = null;

      async function tick() {
        try {
          const res = await runAccountsMindTick();
          if (res.scanned > 0) {
            console.log(
              `[accountsmind-scheduler] scanned=${res.scanned} updated=${res.updated}` +
              ` alerts=${res.alertsGenerated} hivemind_tasks=${res.hivemindTasksPosted}` +
              (res.failed.length ? ` FAILED=${res.failed.length}` : ""),
            );
          }
          if (res.failed.length) {
            for (const f of res.failed) {
              console.warn(`[accountsmind-scheduler] ${f.workspaceId}: ${f.error}`);
            }
          }
        } catch (e: any) {
          console.error("[accountsmind-scheduler] unexpected error:", e?.message ?? e);
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
        `[accountsmind-scheduler] ready — first tick in ${INITIAL_DELAY_MS / 1000}s, then every ${TICK_INTERVAL_MS / 60000} min`,
      );
    },
  };
}
