/**
 * Vite dev-server plugin: WBAH Leads Auto-Sync
 *
 * Pulls all leads and buyer contacts from WeeBespoke and upserts into
 * Supabase. Fires almost immediately on server start (5 s) so data is
 * ready by the time the user signs in, then repeats every 30 minutes.
 */
import type { Plugin } from "vite";
import { runWbahLeadsSyncTick } from "./src/lib/integrations/webespokeEnterprise/wbah-leads-sync-tick";

const TICK_INTERVAL_MS = 30 * 60 * 1000;
const INITIAL_DELAY_MS = 5_000;

export function wbahLeadsSyncPlugin(): Plugin {
  return {
    name: "wbah-leads-sync",
    configureServer(server) {
      let intervalId: ReturnType<typeof setInterval> | null = null;
      let timeoutId:  ReturnType<typeof setTimeout>  | null = null;

      async function tick() {
        try {
          const result = await runWbahLeadsSyncTick();
          console.log(
            `[wbah-leads-sync] sellers=${result.sellers} contacts=${result.contacts}` +
            (result.errors.length ? ` errors=${result.errors.join("; ")}` : ""),
          );
        } catch (e: any) {
          console.error("[wbah-leads-sync] unexpected error:", e?.message ?? e);
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

      console.log(`[wbah-leads-sync] ready — first sync in 5 s, then every 30 min`);
    },
  };
}
