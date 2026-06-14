/**
 * Vite dev-server plugin: Provider Health Sweep
 *
 * Calls POST /api/public/provider-health-sweep every 15 minutes so that
 * all configured provider connections are health-checked and their
 * status is persisted to provider_settings.
 *
 * The HTTP round-trip avoids the @/ alias resolution issue that arises when
 * importing from src/ at vite.config.ts parse time (before aliases are applied).
 * All health-check logic lives in the API route itself — same code path used by
 * the pg_cron production sweep.
 */
import type { Plugin } from "vite";

const TICK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const INITIAL_DELAY_MS = 90_000;          // 90 s — let the server fully warm up first

export function providerHealthSweepPlugin(): Plugin {
  return {
    name: "provider-health-sweep",
    configureServer(server) {
      let port = 5000;
      let intervalId: ReturnType<typeof setInterval> | null = null;
      let timeoutId:  ReturnType<typeof setTimeout>  | null = null;

      server.httpServer?.once("listening", () => {
        const addr = server.httpServer?.address();
        if (addr && typeof addr === "object") port = (addr as any).port ?? 5000;
      });

      async function tick() {
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!serviceKey) return; // nothing to do without the service key
        try {
          const res = await fetch(`http://localhost:${port}/api/public/provider-health-sweep`, {
            method: "POST",
            headers: { Authorization: `Bearer ${serviceKey}` },
          });
          if (res.ok) {
            const result: any = await res.json().catch(() => ({}));
            if ((result.checked ?? 0) > 0) {
              console.log(
                `[provider-health-sweep] workspaces=${result.workspaces} checked=${result.checked} ✓${result.passed} ✗${result.failed}`,
              );
            }
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
