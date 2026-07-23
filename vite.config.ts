// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import path from "node:path";
import { hyperStreamRelayPlugin } from "./hyperstream-relay.plugin";
import { elVoiceRelayPlugin } from "./el-voice-relay.plugin";
import { telephonyStreamPlugin } from "./telephony-stream.plugin";
import { frejunStreamPlugin } from "./frejun-stream.plugin";
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
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    // Expose WEBESPOKE_API_BASE_URL from .env to SSR + import.meta.env (not only VITE_*).
    // SECURITY: never widen this to "WEBESPOKE_" — that would bake WEBESPOKE_ADMIN_PASSWORD
    // into the client bundle at build time. Only this exact (non-secret) var is exposed.
    envPrefix: ["VITE_", "WEBESPOKE_API_BASE_URL"],
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
    plugins: [hyperStreamRelayPlugin(), elVoiceRelayPlugin(), telephonyStreamPlugin(), frejunStreamPlugin(), campaignSchedulerPlugin(), videoJobPollerPlugin(), providerHealthSweepPlugin(), adsSyncPlugin(), trendScoutPlugin(), accountsMindSchedulerPlugin()],
    resolve: {
      alias: {
        "entities/lib/decode.js": path.resolve(
          process.cwd(),
          "node_modules/entities/lib/decode.js",
        ),
        "entities/lib/encode.js": path.resolve(
          process.cwd(),
          "node_modules/entities/lib/encode.js",
        ),
        entities: path.resolve(process.cwd(), "node_modules/entities"),
      },
    },
  },
});
