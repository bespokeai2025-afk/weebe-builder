/**
 * One-time migration: growthmind_gads_analysis_reports table.
 *
 * Run: node scripts/apply-gads-analysis-reports-migration.mjs
 * Always exits 0 — never blocks post-merge.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  resolve(__dir, "../supabase/migrations/20260727090000_gads_analysis_reports.sql"),
  "utf8",
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mgmtToken    = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef   = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

if (SUPABASE_URL && SERVICE_KEY) {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { error } = await supabase.from("growthmind_gads_analysis_reports").select("id").limit(1);
    if (!error) {
      console.log("✅ growthmind_gads_analysis_reports already present — nothing to do.");
      process.exit(0);
    }
    console.log("Table missing — proceeding with migration.\n");
  } catch (err) {
    console.warn("[gads-analysis-reports-migration] Probe failed:", err?.message);
  }
} else {
  console.log("[gads-analysis-reports-migration] No Supabase credentials found — printing SQL for manual apply.");
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
      console.log("✅ gads-analysis-reports migration applied via Management API!");
      refreshSchemaMap();
      process.exit(0);
    }
    console.warn("[gads-analysis-reports-migration] Management API error:", JSON.stringify(json));
  } catch (err) {
    console.warn("[gads-analysis-reports-migration] Management API network error:", err?.message);
  }
}

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("⚠️  Apply this SQL in your Supabase project's SQL Editor:");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
console.log(SQL);
process.exit(0);
