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
import { createRequire } from "node:module";
// One plugin mounts every voice relay (HyperStream, cascade, Twilio, FreJun);
// the relays themselves live in src/lib/voice/gateway so production runs the
// same code via scripts/prod-entry.mjs.
import { voiceGatewayPlugin } from "./voice-gateway.plugin";
import { campaignSchedulerPlugin } from "./campaign-scheduler.plugin";
import { videoJobPollerPlugin } from "./video-job-poller.plugin";
import { providerHealthSweepPlugin } from "./provider-health-sweep.plugin";
import { adsSyncPlugin } from "./ads-sync.plugin";
import { trendScoutPlugin } from "./trend-scout.plugin";
import { accountsMindSchedulerPlugin } from "./accountsmind-scheduler.plugin";
// WBAH background sync plugins (leads/calls/category) are intentionally disabled.
// They each logged into WeeBespoke with the shared admin account every few minutes,
// and WeeBespoke only allows ONE active session — so the constant background churn
// kept kicking the human admin out of the WeeBespoke dashboard, breaking its own
// Dynamics → People pull. WBAH People data is now read on demand only.
// import { wbahLeadsSyncPlugin } from "./wbah-leads-sync.plugin";
// import { wbahCallsSyncPlugin } from "./wbah-calls-sync.plugin";
// import { wbahCategorySyncPlugin } from "./wbah-category-sync.plugin";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
// Nitro + `vercel` preset is required for Vercel deploys (otherwise only static assets → 404).
// EC2/production still uses dist/server + srvx when VERCEL is unset.
// Lovable's nitro wrapper defaults output to dist/ — override to Vercel Build Output API paths.
const isVercelBuild = !!(process.env.VERCEL || process.env.VERCEL_ENV);

/** htmlparser2@8 expects entities@4 `lib/*`; parse5 hoists entities@8 at the root. */
const require = createRequire(import.meta.url);
const entitiesDecodePath = require.resolve("entities/lib/decode.js", {
  paths: [require.resolve("htmlparser2")],
});
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
    // Chunk grouping for the CLIENT bundle only.
    //
    // Route components are ALREADY code-split — @tanstack/start-plugin-core pushes
    // tanStackRouterCodeSplitter unconditionally and hardcodes autoCodeSplitting:true,
    // so the ~350 static imports in routeTree.gen.ts are reference imports, not
    // eagerly-loaded components. The problem was never splitting, it was GROUPING:
    //   - @supabase/* landed in the shared entry, so every visitor to the marketing
    //     homepage downloaded and executed GoTrue before seeing a headline.
    //   - lucide-react emitted one chunk PER ICON: 298 of 569 chunks were under 3 KB,
    //     i.e. hundreds of HTTP requests to draw a few dozen glyphs.
    //
    // Scoped under environments.client so the SSR build is untouched (it has its own
    // externals and must not be regrouped). Neither @lovable.dev/vite-tanstack-config
    // nor start-plugin-core sets environments/rollupOptions/manualChunks, so this key
    // is unclaimed — re-verify that before upgrading either package.
    environments: {
      client: {
        build: {
          rollupOptions: {
            output: {
              manualChunks(id: string) {
                const n = id.split("\\").join("/");
                // NEVER regroup application code. Pulling route modules into a
                // shared chunk would defeat the per-route splitting above and put
                // the 1 MB builder back onto the critical path.
                if (!n.includes("/node_modules/")) return;

                // The whole Supabase client surface. GoTrue/realtime/postgrest/
                // storage/functions ship as separate packages, so match the scope
                // and the standalone names.
                if (
                  /\/node_modules\/@supabase\//.test(n) ||
                  /\/node_modules\/(gotrue-js|realtime-js|postgrest-js|storage-js|functions-js)\//.test(n)
                ) {
                  return "vendor-supabase";
                }

                // Collapse the per-icon chunks into one cacheable file.
                if (/\/node_modules\/lucide-react\//.test(n)) return "vendor-icons";

                // Exact package-root matches only — a loose /react/ test would also
                // swallow react-hook-form, react-markdown, @react-email, etc.
                if (/\/node_modules\/(react|react-dom|scheduler)\//.test(n)) {
                  return "vendor-react";
                }

                return;
              },
            },
          },
        },
      },
    },
    plugins: [voiceGatewayPlugin(), campaignSchedulerPlugin(), videoJobPollerPlugin(), providerHealthSweepPlugin(), adsSyncPlugin(), trendScoutPlugin(), accountsMindSchedulerPlugin()],
    resolve: {
      alias: {
        "entities/lib/decode.js": entitiesDecodePath,
        // encode.js exists on disk but is not in entities@4 exports — map directly.
        "entities/lib/encode.js": path.join(entitiesLibDir, "encode.js"),
      },
    },
  },
});
