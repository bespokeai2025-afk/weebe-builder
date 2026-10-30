// Bundles the automation worker (src/lib/automation-engine/worker/main.ts) to
// dist/automation-worker.mjs — a separate process that runs queued automation work
// off the web server. Same approach as build-voice-gateway.mjs: dependencies stay
// external and resolve from node_modules; `@/` imports resolve through tsconfig paths.

import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const deps = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];

const result = await build({
  entryPoints: [resolve(root, "src/lib/automation-engine/worker/main.ts")],
  outfile: resolve(root, "dist/automation-worker.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  tsconfig: resolve(root, "tsconfig.json"),
  external: deps.flatMap((d) => [d, `${d}/*`]),
  // CommonJS dependencies loaded from ESM need a require().
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
  metafile: true,
});

for (const [file, meta] of Object.entries(result.metafile.outputs)) {
  console.log(`[build-automation-worker] ${file} — ${(meta.bytes / 1024).toFixed(1)} kB`);
}
