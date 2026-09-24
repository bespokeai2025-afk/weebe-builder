/**
 * Applies 20261005000000_call_custom_analysis_data.sql via the Supabase Management API, then
 * confirms PostgREST can see the new column before returning — the schema cache otherwise makes a
 * successful migration look like it failed.
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
if (!URL_ || !KEY || !MGMT) throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ACCESS_TOKEN required");

const ref = new URL(URL_).hostname.split(".")[0];
const sql = readFileSync(resolve(__dir, "../supabase/migrations/20261005000000_call_custom_analysis_data.sql"), "utf8");

const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${MGMT}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
console.log("migration ->", r.status, (await r.text()).slice(0, 200));
if (!r.ok) process.exit(1);

await new Promise((res) => setTimeout(res, 3000));
const probe = await fetch(`${URL_}/rest/v1/calls?select=custom_analysis_data&limit=1`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
});
console.log("PostgREST sees the column ->", probe.status, probe.ok ? "yes" : (await probe.text()).slice(0, 200));
process.exit(probe.ok ? 0 : 1);
