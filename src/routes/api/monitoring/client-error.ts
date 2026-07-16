/**
 * POST /api/monitoring/client-error
 *
 * Receives crash reports from the root error boundary so client-side render
 * errors (which never hit server logs otherwise) become visible in
 * production deployment logs. Rate-limited per instance, no auth (fires
 * exactly when auth state may be broken), never throws.
 */
import { createFileRoute } from "@tanstack/react-router";

let windowStart = 0;
let count = 0;

export const Route = createFileRoute("/api/monitoring/client-error")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const now = Date.now();
          if (now - windowStart > 60_000) {
            windowStart = now;
            count = 0;
          }
          if (++count > 30) return new Response("ok", { status: 200 });

          const len = parseInt(request.headers.get("content-length") ?? "0", 10);
          if (len > 16_384) return new Response("ok", { status: 200 });
          const raw = (await request.text().catch(() => "")).slice(0, 16_384);
          let body: any = {};
          try {
            body = JSON.parse(raw);
          } catch {}
          // Single-line-safe: strip CR/LF + control chars so user input cannot
          // forge extra log lines.
          const clean = (v: unknown, max: number) =>
            String(v ?? "")
              .replace(/[\r\n\u0000-\u001f\u007f]+/g, " | ")
              .slice(0, max);
          const msg = clean(body?.message, 500);
          const stack = clean(body?.stack, 2000);
          const url = clean(body?.url, 300).split("?")[0];
          const ua = clean(request.headers.get("user-agent"), 200);
          console.error(
            `[client-error] url=${url} msg=${msg} ua=${ua} stack=${stack}`,
          );
        } catch {}
        return new Response("ok", { status: 200 });
      },
    },
  },
});
