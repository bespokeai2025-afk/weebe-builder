// READ-ONLY Supabase schema snapshot for migration audit.
// Uses the Supabase Management API (SUPABASE_ACCESS_TOKEN) to run metadata-only
// SELECT queries against the live DB. Writes results to .local/migration_audit/db-snapshot.json.
// NO writes, NO DDL, NO destructive statements are ever issued.
import { writeFileSync } from "node:fs";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
if (!token) { console.error("MISSING SUPABASE_ACCESS_TOKEN"); process.exit(2); }
if (!url) { console.error("MISSING SUPABASE_URL/VITE_SUPABASE_URL"); process.exit(2); }

const host = new URL(url).host; // <ref>.supabase.co
const projectRef = host.split(".")[0];

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const snapshot = { projectRef, generatedAt: new Date().toISOString() };

try {
  snapshot.migration_history = await q(
    `select version, name from supabase_migrations.schema_migrations order by version`
  ).catch((e) => ({ error: String(e.message || e) }));

  snapshot.tables = await q(
    `select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name`
  );

  snapshot.columns = await q(
    `select table_name, column_name, data_type from information_schema.columns where table_schema='public' order by table_name, column_name`
  );

  snapshot.indexes = await q(
    `select tablename, indexname from pg_indexes where schemaname='public' order by tablename, indexname`
  );

  snapshot.policies = await q(
    `select tablename, policyname, cmd from pg_policies where schemaname='public' order by tablename, policyname`
  );

  snapshot.functions = await q(
    `select routine_name, data_type as returns from information_schema.routines where routine_schema='public' order by routine_name`
  );

  snapshot.triggers = await q(
    `select event_object_table as table_name, trigger_name, event_manipulation from information_schema.triggers where trigger_schema='public' order by event_object_table, trigger_name`
  );

  // All-schema triggers (catches auth.users triggers like on_auth_user_created)
  snapshot.triggers_all = await q(
    `select t.tgname as trigger_name, n.nspname as schema, c.relname as table_name from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal order by n.nspname, c.relname, t.tgname`
  );

  // All-schema functions (catches SECURITY DEFINER fns outside public)
  snapshot.functions_all = await q(
    `select n.nspname as schema, p.proname as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not in ('pg_catalog','information_schema') order by n.nspname, p.proname`
  );

  snapshot.extensions = await q(
    `select extname, extversion from pg_extension order by extname`
  );

  snapshot.cron_jobs = await q(
    `select jobid, jobname, schedule, active from cron.job order by jobname`
  ).catch((e) => ({ error: String(e.message || e) }));

  snapshot.rls_enabled = await q(
    `select c.relname as table_name, c.relrowsecurity as rls_enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname`
  );

  writeFileSync(".local/migration_audit/db-snapshot.json", JSON.stringify(snapshot, null, 2));
  const count = (x) => Array.isArray(x) ? x.length : (x && x.error ? `ERROR: ${x.error}` : "n/a");
  console.log("SNAPSHOT OK  ref=" + projectRef);
  console.log("tables:", count(snapshot.tables));
  console.log("columns:", count(snapshot.columns));
  console.log("indexes:", count(snapshot.indexes));
  console.log("policies:", count(snapshot.policies));
  console.log("functions:", count(snapshot.functions));
  console.log("triggers:", count(snapshot.triggers));
  console.log("extensions:", count(snapshot.extensions));
  console.log("cron_jobs:", count(snapshot.cron_jobs));
  console.log("migration_history:", count(snapshot.migration_history));
} catch (e) {
  console.error("SNAPSHOT FAILED:", e.message || e);
  process.exit(1);
}
