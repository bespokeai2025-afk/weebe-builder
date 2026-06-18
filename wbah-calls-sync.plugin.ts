import type { Plugin } from "vite";
import { runWbahCallsSyncTick } from "./src/lib/integrations/webespokeEnterprise/wbah-leads-sync-tick";

export function wbahCallsSyncPlugin(): Plugin {
  return {
    name: "wbah-calls-sync",
    configureServer() {
      const FIRST_DELAY_MS = 3 * 60 * 1000;
      const INTERVAL_MS    = 4 * 60 * 60 * 1000;

      console.log("[wbah-calls-sync] ready — first sync in 3 min, then every 4 h");

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

      setTimeout(() => {
        tick();
        setInterval(tick, INTERVAL_MS);
      }, FIRST_DELAY_MS);
    },
  };
}
