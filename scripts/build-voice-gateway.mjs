// Bundles the voice WebSocket gateway for production.
//
// Why a separate artifact: scripts/prod-entry.mjs is plain Node ESM and cannot
// import TypeScript, and the relays are not reachable from the SSR bundle's
// public exports. Vite's SSR build also has no notion of "attach an upgrade
// listener to the HTTP server", which is exactly what the gateway needs.
//
// So the gateway is compiled once at build time to dist/voice-gateway.mjs and
// imported by prod-entry.mjs at boot.
//
// Runtime deps (ws, @supabase/supabase-js, @msgpack/msgpack) stay external and
// are resolved from node_modules — bundling `ws` would drag in its optional
// native addons (bufferutil, utf-8-validate) which are require()d dynamically.

import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const result = await build({
  entryPoints: [resolve(root, "src/lib/voice/gateway/mount.ts")],
  outfile: resolve(root, "dist/voice-gateway.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Must match the `engines.node` floor in package.json.
  external: ["ws", "@supabase/supabase-js", "@msgpack/msgpack"],
  logLevel: "info",
  metafile: true,
});

const outputs = Object.entries(result.metafile.outputs);
for (const [file, meta] of outputs) {
  console.log(`[build-voice-gateway] ${file} — ${(meta.bytes / 1024).toFixed(1)} kB`);
}
