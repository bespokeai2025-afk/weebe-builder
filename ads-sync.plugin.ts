/**
 * Vite dev-server plugin: Ads Analytics Sync
 *
 * Periodically pulls live campaign metrics from Meta Ads and Google Ads for
 * all workspaces that have credentials configured. Runs every 15 minutes.
 *
 * In production the same logic is invoked via the HTTP endpoint
 *   POST /api/public/ads-sync
 * which is called by a pg_cron job.
 */
import type { Plugin } from "vite";
import { runAdsSyncTick } from "./src/lib/growthmind/growthmind.ads-sync-tick";

const TICK_INTERVAL_MS = 15 * 60 * 1000;
const INITIAL_DELAY_MS = 90_000;

export function adsSyncPlugin(): Plugin {
  return {
    name: "ads-sync",
    configureServer(server) {
      let intervalId: ReturnType<typeof setInterval> | null = null;
      let timeoutId:  ReturnType<typeof setTimeout>  | null = null;

      async function tick() {
        try {
          const summary = await runAdsSyncTick();
          if (summary.synced > 0 || summary.errors > 0) {
            console.log(
              `[ads-sync] synced=${summary.synced} errors=${summary.errors} skipped=${summary.skipped}`,
              summary.results
                .filter(r => r.status !== "skipped")
                .map(r => `${r.platform}:${r.workspaceId.slice(0, 8)} campaigns=${r.campaignsSynced} spend=${r.spendTotal.toFixed(2)}`)
                .join(", "),
            );
          }
        } catch (e: any) {
          console.error("[ads-sync] unexpected error:", e?.message ?? e);
        }
      }

      timeoutId = setTimeout(() => {
        tick();
        intervalId = setInterval(tick, TICK_INTERVAL_MS);
      }, INITIAL_DELAY_MS);

      server.httpServer?.on("close", () => {
        if (timeoutId)  clearTimeout(timeoutId);
        if (intervalId) clearInterval(intervalId);
      });

      console.log(
        `[ads-sync] ready — first tick in ${INITIAL_DELAY_MS / 1000}s, then every ${TICK_INTERVAL_MS / 60_000} min`,
      );
    },
  };
}
