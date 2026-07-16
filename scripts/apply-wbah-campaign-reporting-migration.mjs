/**
 * One-time migration: WBAH campaign reporting tables
 *   wbah_campaign_snapshot, wbah_campaign_runs
 *
 * Run: node scripts/apply-wbah-campaign-reporting-migration.mjs
 * Always exits 0 — never blocks post-merge regardless of credential/network state.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  resolve(__dir, "../supabase/migrations/20260716000000_wbah_campaign_reporting.sql"),
  "utf8",
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mgmtToken    = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef   = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

const TABLES = ["wbah_campaign_snapshot", "wbah_campaign_runs"];

if (SUPABASE_URL && SERVICE_KEY) {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    let allPresent = true;
    for (const table of TABLES) {
      const { error } = await supabase.from(table).select("id").limit(1);
      if (error) { allPresent = false; break; }
    }
    if (allPresent) {
      console.log("✅ WBAH campaign reporting tables already exist — nothing to do.");
      process.exit(0);
    }
  } catch (err) {
    console.warn("[wbah-campaign-migration] check failed:", err?.message);
  }
}

if (projectRef && mgmtToken) {
  try {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${mgmtToken}` },
        body: JSON.stringify({ query: SQL }),
      },
    );
    const json = await res.json().catch(() => null);
    if (res.ok) {
      console.log("✅ WBAH campaign reporting migration applied via Management API!");
      process.exit(0);
    }
    console.warn("[wbah-campaign-migration] Management API error:", JSON.stringify(json));
  } catch (err) {
    console.warn("[wbah-campaign-migration] network error:", err?.message);
  }
}

console.log("⚠️  Apply this SQL manually in the Supabase SQL Editor:\n");
console.log(SQL);
process.exit(0);
