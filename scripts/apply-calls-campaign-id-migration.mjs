/**
 * One-time migration: calls.campaign_id + supporting indexes for campaign
 * minute tracking (supabase/migrations/20260728120000_calls_campaign_id.sql).
 *
 * Run: node scripts/apply-calls-campaign-id-migration.mjs
 * Always exits 0 — never blocks post-merge regardless of credential/network state.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  resolve(__dir, "../supabase/migrations/20260728120000_calls_campaign_id.sql"),
  "utf8",
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mgmtToken = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

if (SUPABASE_URL && SERVICE_KEY) {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { error } = await supabase.from("calls").select("campaign_id").limit(1);
    if (!error) {
      console.log("✅ calls.campaign_id already exists — nothing to do.");
      process.exit(0);
    }
  } catch (err) {
    console.warn("[calls-campaign-id-migration] check failed:", err?.message);
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
      console.log("✅ calls.campaign_id migration applied via Management API!");
      process.exit(0);
    }
    console.warn("[calls-campaign-id-migration] Management API error:", JSON.stringify(json));
  } catch (err) {
    console.warn("[calls-campaign-id-migration] network error:", err?.message);
  }
} else {
  console.warn("[calls-campaign-id-migration] SUPABASE_ACCESS_TOKEN not set — apply SQL manually.");
}
process.exit(0);
