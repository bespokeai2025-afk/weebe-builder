// Apply one or more migration .sql files to the live Supabase database through the Management API.
//
//   node scripts/apply-migration.mjs supabase/migrations/20261017000000_operational_log_retention.sql [...]
//
// Each file is sent whole (one request), so DO $$ … $$ blocks survive, inside the Management API's
// implicit transaction. Stops at the first failure. Migrations here are written to be re-runnable
// (IF NOT EXISTS / CREATE OR REPLACE), but this script does not check — only pass files you mean
// to apply. Refreshes src/integrations/supabase/types.ts afterwards.
//
// Needs SUPABASE_ACCESS_TOKEN and SUPABASE_URL (or VITE_SUPABASE_URL), from the environment or .env.
import { readFileSync } from "node:fs";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — rely on the environment.
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
if (!token || !url) {
  console.error("Missing SUPABASE_ACCESS_TOKEN or SUPABASE_URL/VITE_SUPABASE_URL");
  process.exit(1);
}
const ref = new URL(url).host.split(".")[0];

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node scripts/apply-migration.mjs <file.sql> [<file2.sql> ...]");
  process.exit(1);
}

async function runSql(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 800)}`);
  return text;
}

for (const file of files) {
  process.stdout.write(`Applying ${file} ... `);
  try {
    await runSql(`SET lock_timeout='8s';\n${readFileSync(file, "utf8")}`);
    console.log("OK");
  } catch (error) {
    console.log("FAILED");
    console.error(String(error?.message ?? error));
    process.exit(1);
  }
}

console.log(`\nApplied ${files.length} file(s).`);
refreshSchemaMap();
