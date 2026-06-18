/**
 * Vite dev-server plugin: WBAH Calls Auto-Sync
 *
 * Pulls all call-history records from WeeBespoke and upserts into the
 * wbah_calls Supabase table. Fires 10 s after server start so data is
 * ready by the time the user signs in, then repeats every 4 hours.
 */
import type { Plugin } from "vite";
import { runWbahCallsSyncTick } from "./src/lib/integrations/webespokeEnterprise/wbah-leads-sync-tick";

const INITIAL_DELAY_MS = 10_000;
const INTERVAL_MS      = 4 * 60 * 60 * 1000;

export function wbahCallsSyncPlugin(): Plugin {
  return {
    name: "wbah-calls-sync",
    configureServer(server) {
      let intervalId: ReturnType<typeof setInterval> | null = null;
      let timeoutId:  ReturnType<typeof setTimeout>  | null = null;

      async function tick() {
        try {
          const result = await runWbahCallsSyncTick();
          if (result.errors.length) {
            console.warn("[wbah-calls-sync] errors:", result.errors.join("; "));
          } else {
            console.log(`[wbah-calls-sync] calls=${result.calls}`);
          }
        } catch (err: any) {
          console.error("[wbah-calls-sync] tick failed:", err?.message ?? err);
        }
      }

      timeoutId = setTimeout(() => {
        tick();
        intervalId = setInterval(tick, INTERVAL_MS);
      }, INITIAL_DELAY_MS);

      server.httpServer?.on("close", () => {
        if (timeoutId)  clearTimeout(timeoutId);
        if (intervalId) clearInterval(intervalId);
      });

      console.log(`[wbah-calls-sync] ready — first sync in 10 s, then every 4 h`);
    },
  };
}
