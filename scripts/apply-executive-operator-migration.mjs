/**
 * One-time migration: Executive Operator mode + orchestration runs table.
 *
 * Run: node scripts/apply-executive-operator-migration.mjs
 * Always exits 0 — never blocks post-merge.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  resolve(__dir, "../supabase/migrations/20260724000000_executive_operator_orchestration.sql"),
  "utf8",
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mgmtToken    = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef   = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

if (SUPABASE_URL && SERVICE_KEY) {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { error } = await supabase.from("hivemind_orchestration_runs").select("id").limit(1);
    if (!error) {
      console.log("✅ hivemind_orchestration_runs already present — nothing to do.");
      process.exit(0);
    }
  } catch { /* proceed */ }
}

if (projectRef && mgmtToken) {
  console.log("Applying via Supabase Management API...");
  try {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method:  "POST",
        headers: { Authorization: `Bearer ${mgmtToken}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ query: SQL }),
      },
    );
    if (res.ok) {
      console.log("✅ Migration applied successfully.");
      process.exit(0);
    }
    console.warn("Management API returned", res.status, await res.text());
  } catch (err) {
    console.warn("Management API apply failed:", err?.message);
  }
}

console.log("\n--- Apply manually in Supabase SQL Editor: ---\n");
console.log(SQL);
process.exit(0);
