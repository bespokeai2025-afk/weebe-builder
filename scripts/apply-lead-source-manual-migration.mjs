/**
 * Applies 20260922000000_lead_source_manual.sql via the Supabase Management API, then proves a
 * lead can actually be inserted with source = 'manual' — the point of the migration is that the
 * Add Lead button works, so a "migration applied" message on its own proves nothing.
 *
 * The verification insert is written to a real workspace and deleted again.
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
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const MGMT = env.SUPABASE_ACCESS_TOKEN;
if (!URL_ || !KEY || !MGMT) {
  throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ACCESS_TOKEN required");
}

const ref = new URL(URL_).hostname.split(".")[0];
const sql = readFileSync(
  resolve(__dir, "../supabase/migrations/20260922000000_lead_source_manual.sql"),
  "utf8",
);
const query = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${MGMT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Management API ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
};

// ALTER TYPE ... ADD VALUE cannot run inside a transaction block on older Postgres, so it is sent
// on its own rather than bundled with anything else.
await query(sql);
console.log("Migration applied.");

const [{ values }] = await query(`
  select string_agg(e.enumlabel, ', ' order by e.enumsortorder) as values
  from pg_type t join pg_enum e on e.enumtypid = t.oid
  where t.typname = 'lead_source';
`);
console.log(`lead_source is now: ${values}`);
if (!String(values).split(", ").includes("manual")) {
  throw new Error("'manual' is still not a member of lead_source");
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const [ws] = await (
  await fetch(`${URL_}/rest/v1/workspaces?select=id&limit=1`, { headers: H })
).json();

const res = await fetch(`${URL_}/rest/v1/leads`, {
  method: "POST",
  headers: { ...H, Prefer: "return=representation" },
  body: JSON.stringify({
    workspace_id: ws.id,
    full_name: "zz migration probe",
    phone: "+440000000001",
    source: "manual",
  }),
});
const body = await res.text();
if (!res.ok) throw new Error(`Probe insert failed ${res.status}: ${body.slice(0, 300)}`);
const id = JSON.parse(body)[0].id;
await fetch(`${URL_}/rest/v1/leads?id=eq.${id}`, { method: "DELETE", headers: H });
console.log("Verified: a lead inserts with source = 'manual' (probe row removed).");
