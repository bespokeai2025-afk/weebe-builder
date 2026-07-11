// Applies specific root-level migration .sql files to the live Supabase DB via the
// Management API. Each file is sent WHOLE (one request) so DO $$ ... $$ dollar-quoted
// blocks survive intact, wrapped in the Management API's implicit transaction.
// Idempotent by design: files use CREATE TABLE/INDEX IF NOT EXISTS and
// DO ... EXCEPTION WHEN duplicate_object. Stop-on-first-error. READ the file list
// from argv; results written to .local/migration_audit/rootfile-apply-results.json.
import { readFileSync, writeFileSync } from "node:fs";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
if (!token || !url) {
  console.error("Missing SUPABASE_ACCESS_TOKEN or SUPABASE_URL/VITE_SUPABASE_URL");
  process.exit(1);
}
const ref = new URL(url).host.split(".")[0];

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node scripts/apply-rootfile-migrations.mjs <file.sql> [<file2.sql> ...]");
  process.exit(1);
}

async function runSql(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 500)}`);
  return text;
}

const results = [];
for (const f of files) {
  const body = readFileSync(f, "utf8");
  const sql = `SET lock_timeout='8s';\n${body}`;
  process.stdout.write(`Applying ${f} ... `);
  try {
    await runSql(sql);
    console.log("OK");
    results.push({ file: f, status: "OK" });
  } catch (e) {
    console.log("FAILED");
    console.error(String(e.message || e));
    results.push({ file: f, status: "FAILED", error: String(e.message || e) });
    writeFileSync(".local/migration_audit/rootfile-apply-results.json", JSON.stringify(results, null, 2));
    process.exit(1); // stop on first error
  }
}
writeFileSync(".local/migration_audit/rootfile-apply-results.json", JSON.stringify(results, null, 2));
console.log(`\nDone. ${results.filter((r) => r.status === "OK").length}/${files.length} applied.`);

// Auto-refresh the schema map after a successful apply. Non-fatal: a typegen
// hiccup must not mask a successful migration run — the helper warns loudly.
refreshSchemaMap();
