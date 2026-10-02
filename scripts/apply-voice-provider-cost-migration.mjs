/**
 * One-time migration: applies 20261006000000_voice_provider_cost.sql to the live DB.
 * Run: node scripts/apply-voice-provider-cost-migration.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MGMT_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const { error: checkErr } = await supabase.from("calls").select("stt_provider, tts_provider").limit(1);
if (!checkErr) {
  console.log("✅ stt_provider/tts_provider already exist on calls — nothing to do.");
  process.exit(0);
}
if (!checkErr?.message?.includes("stt_provider") && !checkErr?.message?.includes("schema cache")) {
  console.error("Unexpected check error:", checkErr?.message);
  process.exit(1);
}

console.log("Columns missing. Applying migration via Supabase Management API...");

const SQL = readFileSync(
  new URL("../supabase/migrations/20261006000000_voice_provider_cost.sql", import.meta.url),
  "utf8",
);

const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
if (!projectRef) {
  console.error("Could not extract project ref from URL");
  process.exit(1);
}
if (!MGMT_TOKEN) {
  console.log("\nNo SUPABASE_ACCESS_TOKEN set. Please run this SQL manually in the Supabase SQL Editor:\n");
  console.log(SQL);
  process.exit(1);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${MGMT_TOKEN}`,
  },
  body: JSON.stringify({ query: SQL }),
});
const json = await res.json();
if (res.ok) {
  console.log("✅ Migration applied successfully via Management API!");
  refreshSchemaMap();
  process.exit(0);
} else {
  console.error("Management API error:", JSON.stringify(json));
  console.log("\nPlease run this SQL manually in the Supabase SQL Editor instead:\n");
  console.log(SQL);
  process.exit(1);
}
