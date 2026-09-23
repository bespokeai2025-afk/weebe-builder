/**
 * Applies 20260923000000_enable_rls_public_tables.sql, then verifies the result.
 *
 * Verification matters more than usual here: enabling RLS without a policy makes a user-scoped read
 * return zero rows rather than erroring, which is how wati_templates ended up looking like a
 * missing template. So this checks both halves — RLS on, and a policy present wherever the UI needs
 * one — and reports anything left exposed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dir, "../.env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const URL_ = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const MGMT = env.SUPABASE_ACCESS_TOKEN;
if (!URL_ || !MGMT) throw new Error("SUPABASE_URL and SUPABASE_ACCESS_TOKEN required");
const ref = new URL(URL_).hostname.split(".")[0];

const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${MGMT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Management API ${r.status}: ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : null;
};

const TABLES = [
  "api_rate_limit_log",
  "growthmind_ad_performance_log",
  "growthmind_ad_sync_log",
  "growthmind_ad_webhook_events",
  "growthmind_ad_campaigns",
  "growthmind_ad_budget_caps",
  "growthmind_ad_budget_alerts",
];
/** These are read through a user-scoped client, so RLS alone would break them. */
const NEED_POLICY = new Set([
  "growthmind_ad_campaigns",
  "growthmind_ad_budget_caps",
  "growthmind_ad_budget_alerts",
  "growthmind_ad_sync_log",
  "growthmind_ad_performance_log",
]);

await sql(
  readFileSync(resolve(__dir, "../supabase/migrations/20260923000000_enable_rls_public_tables.sql"), "utf8"),
);
console.log("Migration applied.\n");

const rows = await sql(`
  select c.relname as table_name, c.relrowsecurity as rls,
         (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in (${TABLES.map((t) => `'${t}'`).join(",")})
  order by c.relname;
`);

let bad = 0;
for (const r of rows) {
  const needs = NEED_POLICY.has(r.table_name);
  const ok = r.rls === true && (!needs || Number(r.policies) > 0);
  if (!ok) bad++;
  console.log(
    `${r.table_name.padEnd(32)} rls=${String(r.rls).padEnd(5)} policies=${String(r.policies).padEnd(3)} ${
      ok ? "ok" : needs ? "FAIL — needs a policy or the UI reads nothing" : "FAIL — RLS still off"
    }`,
  );
}

const stillOff = await sql(`
  select count(*)::int as n
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relrowsecurity = false;
`);
console.log(`\npublic tables still without RLS anywhere in the project: ${stillOff[0].n}`);
if (bad > 0) throw new Error(`${bad} table(s) not correctly secured`);
console.log("All seven secured.");
