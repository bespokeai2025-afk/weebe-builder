// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
// SECURITY: env-guard MUST be the first import — it normalizes a corrupted
// VITE_SUPABASE_URL/SUPABASE_URL secret before any plugin captures process.env.
import { CANONICAL_SUPABASE_URL } from "./env-guard";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import path from "node:path";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import type { Plugin } from "vite";
import type { OutputChunk } from "rollup";
import { createRequire } from "node:module";
// One plugin mounts every voice relay (HyperStream, cascade, Twilio, FreJun);
// the relays themselves live in src/lib/voice/gateway so production runs the
// same code via scripts/prod-entry.mjs.
import { voiceGatewayPlugin } from "./dev-plugins/voice-gateway.plugin";
import { campaignSchedulerPlugin } from "./dev-plugins/campaign-scheduler.plugin";
import { videoJobPollerPlugin } from "./dev-plugins/video-job-poller.plugin";
import { providerHealthSweepPlugin } from "./dev-plugins/provider-health-sweep.plugin";
import { staleCallSweepPlugin } from "./dev-plugins/stale-call-sweep.plugin";
import { adsSyncPlugin } from "./dev-plugins/ads-sync.plugin";
import { trendScoutPlugin } from "./dev-plugins/trend-scout.plugin";
import { accountsMindSchedulerPlugin } from "./dev-plugins/accountsmind-scheduler.plugin";
// The WBAH background sync plugins (leads/calls/category) were removed: each logged into
// WeeBespoke with the shared admin account every few minutes, and WeeBespoke allows only one
// active session, so they kept kicking the human admin out. WBAH People data is read on demand.

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
// Nitro + `vercel` preset is required for Vercel deploys (otherwise only static assets → 404).
// EC2/production still uses dist/server + srvx when VERCEL is unset.
// Lovable's nitro wrapper defaults output to dist/ — override to Vercel Build Output API paths.
const isVercelBuild = !!(process.env.VERCEL || process.env.VERCEL_ENV);

// The scheduler plugins below dial leads, sync ads and sweep calls against whatever database
// .env points at — production, usually. Production schedules them through pg_cron, so here they
// only run when asked for (ENABLE_DEV_BACKGROUND_JOBS=1 npm run dev), and never under vitest.
const runDevBackgroundJobs = process.env.ENABLE_DEV_BACKGROUND_JOBS === "1" && !process.env.VITEST;
// BUNDLE_REPORT=1 npm run build → dist/bundle-report-<env>.json: each output chunk with the source
// modules (and their rendered sizes) inside it, largest first. Off by default.
const bundleReport: Plugin[] =
  process.env.BUNDLE_REPORT === "1"
    ? [
        {
          name: "bundle-report",
          apply: "build",
          generateBundle(_options, bundle) {
            const chunks = Object.values(bundle)
              .filter((c): c is OutputChunk => c.type === "chunk")
              .map((c) => ({
                file: c.fileName,
                bytes: c.code.length,
                isEntry: c.isEntry,
                isDynamicEntry: c.isDynamicEntry,
                modules: Object.entries(c.modules)
                  .map(([id, m]) => ({ id: id.replace(process.cwd(), ""), bytes: m.renderedLength }))
                  .sort((a, b) => b.bytes - a.bytes)
                  .slice(0, 40),
              }))
              .sort((a, b) => b.bytes - a.bytes);
            mkdirSync("dist", { recursive: true });
            writeFileSync(
              `dist/bundle-report-${this.environment?.name ?? "build"}.json`,
              JSON.stringify(chunks, null, 2),
            );
          },
        },
      ]
    : [];

const devBackgroundJobs = runDevBackgroundJobs
  ? [
      campaignSchedulerPlugin(),
      videoJobPollerPlugin(),
      providerHealthSweepPlugin(),
      staleCallSweepPlugin(),
      adsSyncPlugin(),
      trendScoutPlugin(),
      accountsMindSchedulerPlugin(),
    ]
  : [];

/**
 * htmlparser2@8 expects entities@4 `lib/*`; parse5 needs entities@8. Resolve the v4 copy
 * htmlparser2 actually uses. npm nests it next to htmlparser2; pnpm may hoist either version to
 * the root, so fall back to the v4 copy in the pnpm store.
 */
const require = createRequire(import.meta.url);
function resolveEntitiesV4Decode(): string {
  try {
    return require.resolve("entities/lib/decode.js", { paths: [require.resolve("htmlparser2")] });
  } catch {
    const store = path.resolve("node_modules/.pnpm");
    const v4 = existsSync(store)
      ? readdirSync(store).filter((d) => /^entities@4\./.test(d)).sort().pop()
      : undefined;
    const candidate = v4 && path.join(store, v4, "node_modules/entities/lib/decode.js");
    if (candidate && existsSync(candidate)) return candidate;
    throw new Error("entities@4 (lib/decode.js) not found — needed for htmlparser2@8");
  }
}
const entitiesDecodePath = resolveEntitiesV4Decode();
const entitiesLibDir = path.dirname(entitiesDecodePath);

export default defineConfig({
  nitro: isVercelBuild
    ? {
        preset: "vercel",
        output: {
          dir: ".vercel/output",
          publicDir: ".vercel/output/static",
          // Must match Nitro vercel preset (config.json routes to /__server → __server.func).
          serverDir: ".vercel/output/functions/__server.func",
        },
      }
    : undefined,
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    // Expose WEBESPOKE_API_BASE_URL from .env to SSR + import.meta.env (not only VITE_*).
    // SECURITY: never widen this to "WEBESPOKE_" — that would bake WEBESPOKE_ADMIN_PASSWORD
    // into the client bundle at build time. Only this exact (non-secret) var is exposed.
    envPrefix: ["VITE_", "WEBESPOKE_API_BASE_URL"],
    // Hard override: guarantees the client bundle always gets the pinned public URL,
    // never whatever is currently stored in the VITE_SUPABASE_URL secret (see guard above).
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(CANONICAL_SUPABASE_URL),
    },
    server: {
      host: "0.0.0.0",
      port: 5000,
      strictPort: true,
      allowedHosts: true,
      proxy: {
        "/__mockup": {
          target: "http://localhost:23636",
          changeOrigin: true,
          ws: true,
        },
      },
    },
    // Server-only modules that must never enter the client bundle.
    // These are Node.js built-ins pulled in transitively through server-function
    // files. Marking them external prevents Rollup from trying to bundle the
    // browser-stub versions (which don't export the named symbols used).
    build: {
      sourcemap: false,
      rollupOptions: {
        external: [
          // Catch any `node:`-prefixed built-in (e.g. `node:crypto`), which is a
          // distinct specifier from the bare name and must be matched separately.
          /^node:/,
          "child_process",
          "util",
          "fs/promises",
          "fs",
          "path",
          "os",
          "crypto",
          "stream",
          "http",
          "https",
          "net",
          "tls",
          "events",
          "buffer",
        ],
      },
    },
    plugins: [voiceGatewayPlugin(), ...devBackgroundJobs, ...bundleReport],
    resolve: {
      alias: {
        "entities/lib/decode.js": entitiesDecodePath,
        // encode.js exists on disk but is not in entities@4 exports — map directly.
        "entities/lib/encode.js": path.join(entitiesLibDir, "encode.js"),
      },
    },
  },
});
