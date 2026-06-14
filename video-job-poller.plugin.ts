/**
 * Vite dev-server plugin: Video Job Poller
 *
 * Polls Veo 3 (Google Vertex AI) and Runway Gen-4 for pending video generation
 * jobs every 30 seconds while the dev server is running.  Once a job completes
 * the real video URL is written back to growthmind_video_assets.video_url.
 *
 * In production the same logic is invoked via the HTTP endpoint
 *   POST /api/public/video-job-poller
 * which is called by a pg_cron job every 30 seconds (or 1 minute).
 */
import type { Plugin } from "vite";
import { runVideoJobPoller } from "./src/lib/growthmind/video-job-poller";

const TICK_INTERVAL_MS = 30_000;
const INITIAL_DELAY_MS = 20_000;

export function videoJobPollerPlugin(): Plugin {
  return {
    name: "video-job-poller",
    configureServer(server) {
      let intervalId: ReturnType<typeof setInterval> | null = null;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      async function tick() {
        try {
          const result = await runVideoJobPoller();
          if (result.checked > 0) {
            console.log(
              `[video-job-poller] checked=${result.checked} resolved=${result.resolved} failed=${result.failed}`,
              result.errors.length ? result.errors : "",
            );
          }
        } catch (e: any) {
          console.error("[video-job-poller] unexpected error:", e?.message ?? e);
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
        `[video-job-poller] ready — first poll in ${INITIAL_DELAY_MS / 1000}s, then every ${TICK_INTERVAL_MS / 1000}s`,
      );
    },
  };
}
