import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * Removes heavy, deliberately-lazy chunks from TanStack Start's route preload
 * manifest.
 *
 * WHY THIS EXISTS
 * Start builds each route's `preloads` list by walking Rollup chunk metadata,
 * including `dynamicImports` (see
 * @tanstack/start-plugin-core/.../normalized-client-build.js). That is the
 * right default — it makes client-side navigation fast. But it means a
 * `React.lazy(() => import(...))` still gets a `<link rel="modulepreload">` in
 * the server-rendered HTML, so the chunk is fetched on first paint by EVERY
 * visitor.
 *
 * For the landing page's three.js scene that is exactly wrong. The scene only
 * mounts at >=900px with a fine pointer and no reduced-motion preference.
 * Without this, a phone downloads ~884 KB of WebGL renderer in order to
 * display a static SVG.
 *
 * WHY closeBundle AND NOT generateBundle
 * Start emits/finalises the manifest module late. A `generateBundle` hook —
 * even with enforce:"post" — runs before the manifest content is settled and
 * silently matches nothing. Rewriting the written file is unambiguous.
 *
 * MAINTENANCE
 * This edits a generated artifact, so it is deliberately loud on success and
 * harmless on failure: if no manifest or no match is found it logs and leaves
 * the build alone rather than throwing. Re-check when upgrading
 * @tanstack/react-start.
 */
export function stripPreloadPlugin(patterns: RegExp[]): Plugin {
  let outRoot = "dist";

  return {
    name: "webee:strip-preload",
    apply: "build",
    enforce: "post",

    configResolved(config) {
      // Walk up from the client outDir to the shared dist root.
      const out = config.build?.outDir ?? "dist/client";
      outRoot = path.resolve(config.root ?? process.cwd(), out, "..");
    },

    closeBundle() {
      const serverAssets = path.join(outRoot, "server", "assets");
      if (!fs.existsSync(serverAssets)) return;

      const manifestFile = fs
        .readdirSync(serverAssets)
        .find((f) => f.includes("_tanstack-start-manifest_v") && f.endsWith(".js"));
      if (!manifestFile) return;

      const manifestPath = path.join(serverAssets, manifestFile);
      let code = fs.readFileSync(manifestPath, "utf8");

      // Match against the real emitted filenames so we never guess a hash.
      const clientAssets = path.join(outRoot, "client", "assets");
      if (!fs.existsSync(clientAssets)) return;
      const targets = fs
        .readdirSync(clientAssets)
        .filter((f) => patterns.some((re) => re.test(f)));
      if (targets.length === 0) return;

      // Replace each hit with a sentinel, then remove the sentinel and its
      // separator with plain string ops. Using a sentinel rather than regex
      // comma-juggling keeps the array syntax valid no matter where in the
      // list the entry sat (first, middle or last).
      const SENTINEL = '"@@webee-strip@@"';
      let removed = 0;
      for (const target of targets) {
        // Only '.' is regex-special in a content-hashed filename.
        const esc = target.split(".").join("[.]");
        code = code.replace(new RegExp('"[^"]*' + esc + '"', "g"), () => {
          removed++;
          return SENTINEL;
        });
      }

      if (removed === 0) {
        console.log(`[strip-preload] nothing matched in ${manifestFile}`);
        return;
      }

      code = code.split("," + SENTINEL).join("");
      code = code.split(SENTINEL + ",").join("");
      code = code.split(SENTINEL).join("");

      fs.writeFileSync(manifestPath, code);
      console.log(
        `[strip-preload] removed ${removed} preload reference(s): ${targets.join(", ")}`,
      );
    },
  };
}
