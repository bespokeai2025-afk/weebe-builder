// READ-ONLY cross-check: parse every migration .sql for the objects it defines,
// then check each against the live DB snapshot. Purely local analysis — no DB access.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MIG_DIR = "supabase/migrations";
const snap = JSON.parse(readFileSync(".local/migration_audit/db-snapshot.json", "utf8"));

// Aggregates / non-migration bundles to skip as standalone migrations
const SKIP = new Set([
  "ALL_MIGRATIONS_RUN_THIS.sql",
  "COMBINED_PRODUCTION_MIGRATIONS.sql",
]);

// ---- Build lookup sets from the snapshot -------------------------------------
const norm = (s) => String(s || "").replace(/^"|"$/g, "").replace(/.*\./, "").toLowerCase().trim();
const tableSet = new Set((snap.tables || []).map((r) => norm(r.table_name)));
const colSet = new Set((snap.columns || []).map((r) => `${norm(r.table_name)}.${norm(r.column_name)}`));
const idxSet = new Set((snap.indexes || []).map((r) => norm(r.indexname)));
const polSet = new Set((snap.policies || []).map((r) => `${norm(r.tablename)}::${String(r.policyname).toLowerCase().trim()}`));
const polNameSet = new Set((snap.policies || []).map((r) => String(r.policyname).toLowerCase().trim()));
const fnSet = new Set([
  ...(snap.functions || []).map((r) => norm(r.routine_name)),
  ...(snap.functions_all || []).map((r) => String(r.name).toLowerCase().trim()),
]);
const trgSet = new Set([
  ...(snap.triggers || []).map((r) => String(r.trigger_name).toLowerCase().trim()),
  ...(snap.triggers_all || []).map((r) => String(r.trigger_name).toLowerCase().trim()),
]);
const cronSet = new Set(Array.isArray(snap.cron_jobs) ? snap.cron_jobs.map((r) => String(r.jobname).toLowerCase().trim()) : []);

// ---- SQL parsing helpers -----------------------------------------------------
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
}
const clean = (s) => s.replace(/^"|"$/g, "").replace(/^public\./i, "").replace(/"/g, "").toLowerCase().trim();

function parse(sql) {
  const s = stripComments(sql);
  const out = { tables: [], columns: [], indexes: [], policies: [], functions: [], triggers: [], crons: [] };

  // CREATE TABLE [IF NOT EXISTS] name
  for (const m of s.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_."]+)/gi))
    out.tables.push(clean(m[1]));

  // ALTER TABLE [IF EXISTS] [ONLY] name ... ADD COLUMN [IF NOT EXISTS] col
  for (const m of s.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([a-zA-Z0-9_."]+)([\s\S]*?)(?=(?:\balter\s+table\b)|;|$)/gi)) {
    const tbl = clean(m[1]);
    for (const c of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_"]+)/gi))
      out.columns.push(`${tbl}.${clean(c[1])}`);
  }

  // CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] name
  for (const m of s.matchAll(/create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_."]+)\s+on/gi))
    out.indexes.push(clean(m[1]));

  // CREATE POLICY "name" ON table
  for (const m of s.matchAll(/create\s+policy\s+("([^"]+)"|[a-zA-Z0-9_]+)\s+on\s+([a-zA-Z0-9_."]+)/gi)) {
    const pol = (m[2] || m[1]).toLowerCase().trim();
    out.policies.push(`${clean(m[3])}::${pol}`);
  }

  // CREATE [OR REPLACE] FUNCTION name(
  for (const m of s.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([a-zA-Z0-9_."]+)\s*\(/gi))
    out.functions.push(clean(m[1]));

  // CREATE [OR REPLACE] [CONSTRAINT] TRIGGER name
  for (const m of s.matchAll(/create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+([a-zA-Z0-9_"]+)/gi))
    out.triggers.push(clean(m[1]));

  // cron.schedule('jobname', ...)
  for (const m of s.matchAll(/cron\.schedule\s*\(\s*'([^']+)'/gi))
    out.crons.push(m[1].toLowerCase().trim());

  // dedupe
  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])];
  return out;
}

// ---- Evaluate each migration file -------------------------------------------
const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql") && !SKIP.has(f)).sort();
const report = [];

for (const f of files) {
  const sql = readFileSync(join(MIG_DIR, f), "utf8");
  const def = parse(sql);
  const missing = { tables: [], columns: [], indexes: [], policies: [], functions: [], triggers: [], crons: [] };

  for (const t of def.tables) if (!tableSet.has(t)) missing.tables.push(t);
  for (const c of def.columns) {
    const [tbl] = c.split(".");
    // only count as missing column if its table exists (else table-missing already covers it)
    if (tableSet.has(tbl) && !colSet.has(c)) missing.columns.push(c);
  }
  for (const i of def.indexes) if (!idxSet.has(i)) missing.indexes.push(i);
  for (const p of def.policies) {
    const [, pname] = p.split("::");
    if (!polSet.has(p) && !polNameSet.has(pname)) missing.policies.push(p);
  }
  for (const fn of def.functions) if (!fnSet.has(fn)) missing.functions.push(fn);
  for (const tg of def.triggers) if (!trgSet.has(tg)) missing.triggers.push(tg);
  for (const cj of def.crons) if (!cronSet.has(cj)) missing.crons.push(cj);

  const defCount = Object.values(def).reduce((a, b) => a + b.length, 0);
  const missCount = Object.values(missing).reduce((a, b) => a + b.length, 0);
  const presentCount = defCount - missCount;

  let status;
  if (defCount === 0) status = "NO_TRACKABLE_DDL"; // data backfill / alter-only / drop / enable-rls
  else if (missCount === 0) status = "APPLIED";
  else if (presentCount === 0) status = "NOT_APPLIED";
  else status = "PARTIAL";

  report.push({ file: f, status, defCount, missCount, def, missing });
}

writeFileSync(".local/migration_audit/crosscheck.json", JSON.stringify(report, null, 2));

// ---- Print summary -----------------------------------------------------------
const by = (st) => report.filter((r) => r.status === st);
console.log("=== SUMMARY ===");
console.log("total migration files analysed:", report.length);
for (const st of ["APPLIED", "PARTIAL", "NOT_APPLIED", "NO_TRACKABLE_DDL"])
  console.log(`${st}: ${by(st).length}`);

const allTables = [...tableSet];
const near = (name) => allTables.filter((t) => t.includes(name) || name.includes(t) || t.split("_")[0] === name.split("_")[0]).slice(0, 4);

console.log("\n=== NOT_APPLIED (all defined objects missing) ===");
for (const r of by("NOT_APPLIED")) {
  console.log(`- ${r.file}  [tables:${r.def.tables.length} cols:${r.def.columns.length} idx:${r.def.indexes.length} pol:${r.def.policies.length} fn:${r.def.functions.length} trg:${r.def.triggers.length} cron:${r.def.crons.length}]`);
  if (r.def.tables.length) {
    console.log(`    defines tables: ${r.def.tables.join(", ")}`);
    for (const t of r.def.tables) { const n = near(t); if (n.length) console.log(`      near("${t}") in DB: ${n.join(", ")}`); }
  }
  if (r.def.columns.length) console.log(`    defines columns: ${r.def.columns.join(", ")}`);
}

console.log("\n=== PARTIAL (some objects missing) ===");
for (const r of by("PARTIAL")) {
  const bits = Object.entries(r.missing).filter(([, v]) => v.length).map(([k, v]) => `${k}:${v.join(",")}`);
  console.log(`- ${r.file}\n    MISSING → ${bits.join(" | ")}`);
}
