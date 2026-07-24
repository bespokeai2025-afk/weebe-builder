/**
 * Vite dev-server plugin: GrowthMind Trend Scout discovery.
 *
 * Periodically runs multi-source trend discovery for all workspaces with
 * Trend Scout enabled and at least one active monitored source. Discovery is
 * free (no AI calls) and capped per workspace by
 * workspace_settings.growthmind_discovery_daily_limit.
 *
 * In production the same logic runs inside POST /api/public/campaign-executor
 * (pg_cron).
 */
import type { Plugin } from "vite";
import { runTrendDiscoveryTick } from "./src/lib/growthmind/trend-discovery.server";

const TICK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h — daily limit gates per workspace
const INITIAL_DELAY_MS = 3 * 60 * 1000;

export function trendScoutPlugin(): Plugin {
  return {
    name: "trend-scout",
    configureServer(server) {
      let intervalId: ReturnType<typeof setInterval> | null = null;
      let timeoutId:  ReturnType<typeof setTimeout>  | null = null;

      async function tick() {
        try {
          const s = await runTrendDiscoveryTick();
          if (s.ran > 0) console.log(`[trend-scout] ran=${s.ran} skipped=${s.skipped} newItems=${s.totalNew}`);
        } catch (e: any) {
          console.error("[trend-scout] unexpected error:", e?.message ?? e);
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

      console.log(`[trend-scout] ready — first tick in ${INITIAL_DELAY_MS / 60000} min, then every ${TICK_INTERVAL_MS / 3600000}h`);
    },
  };
}
