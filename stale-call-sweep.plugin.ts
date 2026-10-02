/**
 * Vite dev-server plugin: Stale Call Sweep
 *
 * Calls POST /api/public/stale-call-sweep every 10 minutes so a native call
 * whose `call_ended` webhook never landed (dev-server reload mid-call, a
 * dropped loopback request) doesn't sit showing "in progress" forever — see
 * stale-call-sweep.server.ts. Same pattern as provider-health-sweep.plugin.ts:
 * the HTTP round-trip avoids the @/ alias resolution issue that arises from
 * importing src/ at vite.config.ts parse time, and the same route also backs
 * the pg_cron production sweep.
 */
import type { Plugin } from "vite";

const TICK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const INITIAL_DELAY_MS = 90_000;         // 90 s — let the server fully warm up first

export function staleCallSweepPlugin(): Plugin {
  return {
    name: "stale-call-sweep",
    configureServer(server) {
      let port = 5000;
      let intervalId: ReturnType<typeof setInterval> | null = null;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      server.httpServer?.once("listening", () => {
        const addr = server.httpServer?.address();
        if (addr && typeof addr === "object") port = (addr as any).port ?? 5000;
      });

      async function tick() {
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!serviceKey) return; // nothing to do without the service key
        try {
          const res = await fetch(`http://localhost:${port}/api/public/stale-call-sweep`, {
            method: "POST",
            headers: { Authorization: `Bearer ${serviceKey}` },
          });
          if (res.ok) {
            const result: any = await res.json().catch(() => ({}));
            if ((result.closed ?? 0) > 0) {
              console.log(`[stale-call-sweep] checked=${result.checked} closed=${result.closed}`);
            }
          }
        } catch (e: any) {
          console.error("[stale-call-sweep] tick error:", e?.message ?? e);
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
        `[stale-call-sweep] ready — first sweep in ${INITIAL_DELAY_MS / 1000}s, then every ${TICK_INTERVAL_MS / 60000} min`,
      );
    },
  };
}
