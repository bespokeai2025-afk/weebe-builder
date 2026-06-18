/**
 * Vite dev-server plugin: WBAH Leads Auto-Sync
 *
 * Periodically pulls all leads and buyer contacts from the WeeBespoke API
 * for the Webuyanyhouse workspace and upserts them into Supabase so the
 * Leads and Qualified pages always show fresh data.
 *
 * Runs every 30 minutes (first tick after 2 minutes to let the server settle).
 */
import type { Plugin } from "vite";
import { runWbahLeadsSyncTick } from "./src/lib/integrations/webespokeEnterprise/wbah-leads-sync-tick";

const TICK_INTERVAL_MS = 30 * 60 * 1000;
const INITIAL_DELAY_MS = 2 * 60 * 1000;

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

      console.log(
        `[wbah-leads-sync] ready — first sync in ${INITIAL_DELAY_MS / 60_000} min, then every ${TICK_INTERVAL_MS / 60_000} min`,
      );
    },
  };
}
