/**
 * Shared helper: refresh the schema map (src/integrations/supabase/types.ts)
 * after a successful migration apply so it can never silently drift.
 *
 * Non-fatal by design — a typegen hiccup must not mask a successful migration
 * run. On failure it prints a loud warning and returns; it never throws or
 * changes the process exit code.
 *
 * Usage (from any scripts/apply-*.mjs, right after a successful apply):
 *   import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";
 *   refreshSchemaMap();
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REFRESH_SCRIPT = path.resolve(__dirname, "..", "refresh-supabase-types.mjs");

export function refreshSchemaMap() {
  console.log("\n▶ Refreshing schema map (src/integrations/supabase/types.ts) ...");
  const refresh = spawnSync(process.execPath, [REFRESH_SCRIPT], { stdio: "inherit" });
  if (refresh.status !== 0) {
    console.error("\n" + "!".repeat(72));
    console.error("!! WARNING: schema-map refresh FAILED (the migration DID apply successfully).");
    console.error("!! src/integrations/supabase/types.ts may now be STALE.");
    console.error("!! Fix by running manually: node scripts/refresh-supabase-types.mjs");
    console.error("!".repeat(72));
  }
}
