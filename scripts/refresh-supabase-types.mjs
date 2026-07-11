// Refresh (or check) src/integrations/supabase/types.ts from the LIVE database.
//
// The generated schema map goes stale as manual migrations are applied. This script
// fetches fresh TypeScript types via the Supabase Management API typegen endpoint
// (no CLI login needed) and either writes the file or reports whether it is stale.
//
// Usage:
//   node scripts/refresh-supabase-types.mjs           # fetch + overwrite types.ts if changed
//   node scripts/refresh-supabase-types.mjs --check   # exit 1 if types.ts is stale (no write)
//
// Requires: SUPABASE_ACCESS_TOKEN and SUPABASE_URL (or VITE_SUPABASE_URL).
// READ-ONLY against the database — typegen only inspects schema metadata.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const TYPES_PATH = "src/integrations/supabase/types.ts";
const checkMode = process.argv.includes("--check");

const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
if (!token) { console.error("MISSING SUPABASE_ACCESS_TOKEN"); process.exit(2); }
if (!url) { console.error("MISSING SUPABASE_URL/VITE_SUPABASE_URL"); process.exit(2); }

const projectRef = new URL(url).host.split(".")[0];

async function fetchTypes() {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/types/typescript?included_schemas=public`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Typegen HTTP ${res.status}: ${text.slice(0, 500)}`);
  const body = JSON.parse(text);
  if (!body || typeof body.types !== "string" || body.types.length < 1000) {
    throw new Error("Typegen response missing/short `types` payload — refusing to proceed");
  }
  return body.types;
}

// Compare ignoring trailing-whitespace/EOF-newline differences so a byte-identical
// schema never reads as "stale".
const normalize = (s) => s.replace(/\r\n/g, "\n").trimEnd();

function diffSummary(oldText, newText) {
  // Cheap signal: which table names appear in one version but not the other.
  const tableNames = (t) => new Set([...t.matchAll(/^      (\w+): \{$/gm)].map((m) => m[1]));
  const a = tableNames(oldText);
  const b = tableNames(newText);
  const added = [...b].filter((x) => !a.has(x));
  const removed = [...a].filter((x) => !b.has(x));
  return { added, removed };
}

try {
  const fresh = await fetchTypes();
  const current = existsSync(TYPES_PATH) ? readFileSync(TYPES_PATH, "utf8") : "";
  const stale = normalize(current) !== normalize(fresh);

  if (!stale) {
    console.log(`OK: ${TYPES_PATH} is up to date with live schema (ref=${projectRef})`);
    process.exit(0);
  }

  const { added, removed } = diffSummary(current, fresh);
  if (added.length) console.log(`Entities in live DB missing from file (${added.length}): ${added.slice(0, 30).join(", ")}${added.length > 30 ? ", ..." : ""}`);
  if (removed.length) console.log(`Entities in file not in live DB (${removed.length}): ${removed.slice(0, 30).join(", ")}${removed.length > 30 ? ", ..." : ""}`);

  if (checkMode) {
    console.error(`STALE: ${TYPES_PATH} differs from live schema. Run: node scripts/refresh-supabase-types.mjs`);
    process.exit(1);
  }

  writeFileSync(TYPES_PATH, fresh.endsWith("\n") ? fresh : fresh + "\n");
  console.log(`UPDATED: wrote fresh types to ${TYPES_PATH} (ref=${projectRef}, ${fresh.length} chars)`);
  console.log("Reminder: this repo does NOT typecheck clean — verify by diffing tsc error file:line locations against a baseline (see .agents/memory/supabase-typegen-refresh.md).");
} catch (e) {
  console.error("REFRESH FAILED:", e.message || e);
  process.exit(2);
}
