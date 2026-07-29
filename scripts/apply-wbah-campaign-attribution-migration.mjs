/**
 * One-time migration: wbah_calls campaign attribution columns
 * (campaign_id, campaign_run_id, lead_id, provider_call_id + index).
 *
 * Run: node scripts/apply-wbah-campaign-attribution-migration.mjs
 * Always exits 0 — never blocks post-merge.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  resolve(__dir, "../supabase/migrations/20260729000000_wbah_calls_campaign_attribution.sql"),
  "utf8",
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mgmtToken    = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef   = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

if (SUPABASE_URL && SERVICE_KEY) {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { error } = await supabase.from("wbah_calls").select("campaign_id, campaign_run_id, lead_id, provider_call_id").limit(1);
    if (!error) {
      console.log("✅ wbah_calls attribution columns already present — nothing to do.");
      process.exit(0);
    }
    console.log("Attribution columns missing — proceeding with migration.\n");
  } catch (err) {
    console.warn("[wbah-attribution-migration] Probe failed:", err?.message);
  }
} else {
  console.log("[wbah-attribution-migration] No Supabase credentials found — printing SQL for manual apply.");
}

if (projectRef && mgmtToken) {
  console.log("Applying via Supabase Management API...");
  try {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${mgmtToken}` },
        body: JSON.stringify({ query: SQL }),
      },
    );
    let json;
    try { json = await res.json(); } catch { json = { raw: await res.text().catch(() => "(unreadable)") }; }
    if (res.ok) {
      console.log("✅ wbah_calls attribution migration applied via Management API!");
      refreshSchemaMap();
      process.exit(0);
    }
    console.warn("[wbah-attribution-migration] Management API error:", JSON.stringify(json));
  } catch (err) {
    console.warn("[wbah-attribution-migration] Management API network error:", err?.message);
  }
}

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("⚠️  Apply this SQL in your Supabase project's SQL Editor:");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
console.log(SQL);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
process.exit(0);
