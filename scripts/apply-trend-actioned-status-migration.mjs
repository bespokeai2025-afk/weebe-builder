/**
 * One-time migration: add 'actioned' to growthmind_trend_items status check.
 * Run: node scripts/apply-trend-actioned-status-migration.mjs
 * Always exits 0 — never blocks post-merge.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  resolve(__dir, "../supabase/migrations/20260918000000_trend_items_actioned_status.sql"),
  "utf8",
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const mgmtToken    = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef   = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

// Check whether 'actioned' is already accepted by the constraint.
if (projectRef && mgmtToken) {
  try {
    const check = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${mgmtToken}` },
        body: JSON.stringify({
          query: `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'growthmind_trend_items_status_check';`,
        }),
      },
    );
    if (check.ok) {
      const rows = await check.json();
      const def = Array.isArray(rows) ? rows[0]?.def ?? "" : "";
      if (def.includes("actioned")) {
        console.log("✅ 'actioned' already in trend items status check — nothing to do.");
        process.exit(0);
      }
    }
  } catch { /* fall through to apply */ }

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
      console.log("✅ Trend 'actioned' status migration applied via Management API!");
      process.exit(0);
    }
    console.warn("[trend-actioned-migration] Management API error:", JSON.stringify(json));
  } catch (err) {
    console.warn("[trend-actioned-migration] Management API network error:", err?.message);
  }
}

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("⚠️  Apply this SQL in your Supabase project's SQL Editor:");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
console.log(SQL);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
process.exit(0);
