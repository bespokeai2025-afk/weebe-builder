// Production server entry for srvx.
//
// Why this exists: `srvx serve --static=...` serves static files with NO
// Cache-Control header, so the Replit proxy defaults everything (including
// immutable hashed /assets/* chunks AND the SSR HTML) to `cache-control:
// private`. That means browsers may cache HTML that references chunk hashes
// from an old deploy ("Failed to fetch dynamically imported module") while
// getting no long-term caching benefit on the hashed assets themselves.
//
// This entry replaces the CLI's --static flag with the same serveStatic
// handler wrapped in a middleware that applies the correct caching strategy:
//   - /assets/*  (content-hashed by Vite)  -> public, max-age=1y, immutable
//   - other static files (logos, favicon)  -> public, max-age=1h, revalidate
//   - SSR HTML responses                   -> no-cache, must-revalidate
//   - missing /assets/* files              -> plain-text 404 (never HTML)
//
// Start with:  srvx serve --prod --entry scripts/prod-entry.mjs --host 127.0.0.1
// (no --static flag — static serving happens here instead).

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "srvx/static";

// SECURITY/RESILIENCE GUARD (mirrors vite.config.ts): the SUPABASE_URL /
// VITE_SUPABASE_URL secrets have repeatedly been saved with the service-role
// key pasted in place of the URL. Normalize before the server bundle loads so
// every process.env read sees a valid URL.
const CANONICAL_SUPABASE_URL = "https://ugrsdmmztnfgeajhwhzy.supabase.co";
const isValidSupabaseUrl = (v) => typeof v === "string" && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(v);
for (const key of ["VITE_SUPABASE_URL", "SUPABASE_URL"]) {
  if (!isValidSupabaseUrl(process.env[key])) process.env[key] = CANONICAL_SUPABASE_URL;
}

const server = (await import("../dist/server/server.js")).default;

const staticDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../dist/client",
);

const rawStatic = serveStatic({ dir: staticDir });

// Sentinel lets us tell "static file served" apart from "fell through to SSR".
const MISS = Symbol("static-miss");

const HASHED_ASSET_RE = /^\/assets\//;

const staticAndCacheHeaders = async (req, next) => {
  const pathname = new URL(req.url).pathname;

  const res = await rawStatic(req, () => MISS);

  if (res !== MISS) {
    // Static file served — apply caching policy by path.
    if (HASHED_ASSET_RE.test(pathname)) {
      // Vite content-hashed chunks: safe to cache forever.
      res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      // Un-hashed public files (logos, favicon, etc.): short cache.
      res.headers.set("Cache-Control", "public, max-age=3600, must-revalidate");
    }
    return res;
  }

  // Missing hashed asset: return a real 404, never an HTML page. A stale tab
  // requesting a deleted chunk must see a clean failure so the client-side
  // chunk-reload guard can recover (an HTML body would poison module parsing).
  if (HASHED_ASSET_RE.test(pathname)) {
    return new Response("Not Found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  // Fall through to the SSR app.
  const appRes = await next();

  // SSR HTML must always revalidate so browsers never render stale HTML that
  // references deleted chunk hashes. Never override headers the app already
  // set (SSE streams, API routes with explicit caching, etc.).
  try {
    const contentType = appRes?.headers?.get?.("Content-Type") || "";
    if (
      contentType.includes("text/html") &&
      !appRes.headers.get("Cache-Control")
    ) {
      appRes.headers.set("Cache-Control", "no-cache, max-age=0, must-revalidate");
    }
  } catch {
    // Never let header decoration break a response.
  }
  return appRes;
};

// Mount the voice WebSocket relays (HyperStream, cascade, Twilio, FreJun).
//
// These used to exist only as Vite dev-server plugins, so in production there
// was no WebSocket endpoint at all: browser test calls and inbound phone calls
// connected and died. srvx exposes the underlying Node HTTP server once ready,
// which is all the gateway needs to attach its `upgrade` listener.
//
// A missing/stale bundle must never take the whole site down, so every failure
// here is logged and swallowed — HTTP keeps serving without voice.
const voiceGatewayPlugin = (srvxServer) => {
  srvxServer
    .ready()
    .then(async (ready) => {
      const httpServer = ready.node?.server;
      if (!httpServer) {
        console.error("[prod-entry] no Node HTTP server available — voice relays INACTIVE");
        return;
      }
      const { mountVoiceGateways } = await import("../dist/voice-gateway.mjs");
      mountVoiceGateways(httpServer);
    })
    .catch((err) => {
      console.error(
        "[prod-entry] failed to mount voice relays — voice calls will not connect:",
        err?.message ?? err,
      );
    });
};

export default {
  ...server,
  fetch: server.fetch,
  middleware: [staticAndCacheHeaders, ...(server.middleware || [])],
  plugins: [...(server.plugins || []), voiceGatewayPlugin],
};
