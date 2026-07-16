/**
 * One-time migration: creates analytics_reports + analytics_report_schedules.
 * Run: node scripts/apply-analytics-hub-migration.mjs
 * Needs SUPABASE_ACCESS_TOKEN (Management API) or prints SQL fallback.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  resolve(__dir, "../supabase/migrations/20260729000000_analytics_hub.sql"),
  "utf8",
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mgmtToken = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

if (SUPABASE_URL && SERVICE_KEY) {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const [a, b] = await Promise.all([
    supabase.from("analytics_reports").select("id").limit(1),
    supabase.from("analytics_report_schedules").select("id").limit(1),
  ]);
  if (!a.error && !b.error) {
    console.log("✅ analytics hub tables already exist — nothing to do.");
    process.exit(0);
  }
  console.log("Tables missing — proceeding with migration.\n");
}

if (projectRef && mgmtToken) {
  console.log("Applying via Supabase Management API...");
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${mgmtToken}`,
    },
    body: JSON.stringify({ query: SQL }),
  });
  const json = await res.json();
  if (res.ok) {
    console.log("✅ analytics hub migration applied via Management API!");
    refreshSchemaMap();
    process.exit(0);
  }
  console.error("Management API error:", JSON.stringify(json));
}

console.log("⚠️  Apply this SQL in the Supabase SQL Editor:\n");
console.log(SQL);
