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

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
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
    plugins: [hyperStreamRelayPlugin(), elVoiceRelayPlugin(), telephonyStreamPlugin(), frejunStreamPlugin(), campaignSchedulerPlugin(), videoJobPollerPlugin()],
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
