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
import server from "../dist/server/server.js";

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

export default {
  ...server,
  fetch: server.fetch,
  middleware: [staticAndCacheHeaders, ...(server.middleware || [])],
};
