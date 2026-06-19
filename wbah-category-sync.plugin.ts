/**
 * Vite dev-server plugin: WBAH Category Lead Sync
 *
 * Runs the categorized lead sync (Disqualified, Tried To Contact, Rebooking)
 * on a background interval. Initial delay of 60s to avoid start-up contention
 * with the main leads sync, then every 30 minutes.
 */
import type { Plugin } from "vite";
import { runWbahCategorySyncTick } from "./src/lib/integrations/webespokeEnterprise/wbah-category-sync";

const TICK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const INITIAL_DELAY_MS = 60_000;          // 60s after start (after leads sync settles)

export function wbahCategorySyncPlugin(): Plugin {
  return {
    name: "wbah-category-sync",
    configureServer(server) {
      let intervalId: ReturnType<typeof setInterval> | null = null;
      let timeoutId:  ReturnType<typeof setTimeout>  | null = null;

      async function tick() {
        try {
          const result = await runWbahCategorySyncTick();
          const dq  = result.disqualified;
          const ttc = result.tried_to_contact;
          const rb  = result.rebooking;
          console.log(
            `[wbah-category-sync] done — dq=${dq.imported}+${dq.updated} ttc=${ttc.imported}+${ttc.updated} rb=${rb.imported}+${rb.updated} ` +
            `total_fetched=${result.total_leads_fetched} duration=${result.duration_ms}ms` +
            (result.errors.length ? ` errors=${result.errors.join("; ")}` : ""),
          );
        } catch (e: any) {
          console.error("[wbah-category-sync] unexpected error:", e?.message ?? e);
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

      console.log(`[wbah-category-sync] ready — first sync in 60s, then every 30 min`);
    },
  };
}
