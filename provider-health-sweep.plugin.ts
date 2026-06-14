/**
 * Vite dev-server plugin: Provider Health Sweep
 *
 * Runs live healthCheck() for all configured providers every 15 minutes
 * and persists results to provider_settings.status.
 *
 * In production the same logic is invoked via:
 *   POST /api/public/provider-health-sweep
 * which is called by a pg_cron job every 15 minutes.
 */
import type { Plugin } from "vite";
import { runAllWorkspacesHealthChecks } from "./src/lib/providers/health.server";

const TICK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const INITIAL_DELAY_MS = 90_000;          // 90 s — let the server warm up first

export function providerHealthSweepPlugin(): Plugin {
  return {
    name: "provider-health-sweep",
    configureServer(server) {
      let intervalId: ReturnType<typeof setInterval> | null = null;
      let timeoutId:  ReturnType<typeof setTimeout>  | null = null;

      async function tick() {
        try {
          const result = await runAllWorkspacesHealthChecks();
          if (result.checked > 0) {
            console.log(
              `[provider-health-sweep] workspaces=${result.workspaces} checked=${result.checked} ✓${result.passed} ✗${result.failed}`,
            );
          }
        } catch (e: any) {
          console.error("[provider-health-sweep] tick error:", e?.message ?? e);
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
        `[provider-health-sweep] ready — first sweep in ${INITIAL_DELAY_MS / 1000}s, then every ${TICK_INTERVAL_MS / 60000} min`,
      );
    },
  };
}
