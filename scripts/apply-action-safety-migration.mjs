/**
 * One-time migration: HiveMind approval modes, action safety & learning loop.
 *
 * Run: node scripts/apply-action-safety-migration.mjs
 * Always exits 0 — never blocks post-merge.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  resolve(__dir, "../supabase/migrations/20260723150000_action_safety_learning.sql"),
  "utf8",
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mgmtToken    = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef   = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

if (SUPABASE_URL && SERVICE_KEY) {
  let supabase;
  try {
    supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  } catch (err) {
    console.warn("[action-safety-migration] Failed to create Supabase client:", err?.message);
    printFallback();
    process.exit(0);
  }

  let tablePresent = false;
  let columnPresent = false;
  try {
    const { error } = await supabase.from("hivemind_confidence_adjustments").select("id").limit(1);
    tablePresent = !error;
  } catch { /* treat as missing */ }
  try {
    const { error } = await supabase.from("hivemind_actions").select("outcome_classification").limit(1);
    columnPresent = !error;
  } catch { /* treat as missing */ }

  if (tablePresent && columnPresent) {
    console.log("✅ action-safety schema already present — nothing to do.");
    process.exit(0);
  }
  console.log("Action-safety schema missing — proceeding with migration.\n");
} else {
  console.log("[action-safety-migration] No Supabase credentials found — printing SQL for manual apply.");
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
      console.log("✅ Action-safety migration applied via Management API!");
      refreshSchemaMap();
      process.exit(0);
    }
    console.warn("[action-safety-migration] Management API error:", JSON.stringify(json));
  } catch (err) {
    console.warn("[action-safety-migration] Management API network error:", err?.message);
  }
}

printFallback();
process.exit(0);

function printFallback() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("⚠️  Apply this SQL in your Supabase project's SQL Editor:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log(SQL);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}
