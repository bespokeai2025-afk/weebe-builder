/**
 * One-time migration: creates the growthmind_video_assets table.
 * Run: node scripts/apply-video-studio-migration.mjs
 *
 * Optional env vars:
 *   SUPABASE_ACCESS_TOKEN — Supabase personal access token (sbp_...) for
 *                           Management API; get at supabase.com/dashboard/account/tokens
 *   SUPABASE_URL / VITE_SUPABASE_URL — project URL (needed for existence check)
 *   SUPABASE_SERVICE_ROLE_KEY — project service role key (needed for existence check)
 *
 * The SQL fallback (printing instructions) always runs regardless of credentials.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  resolve(__dir, "../supabase/migrations/20260704000000_growthmind_video_assets.sql"),
  "utf8",
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mgmtToken    = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef   = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

// ── Step 1: Check if table already exists (only when credentials available) ───
if (SUPABASE_URL && SERVICE_KEY) {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const { error: checkErr } = await supabase
    .from("growthmind_video_assets")
    .select("id")
    .limit(1);

  if (!checkErr) {
    console.log("✅ growthmind_video_assets table already exists — nothing to do.");
    process.exit(0);
  }

  if (checkErr.code !== "PGRST205" && !checkErr.message?.includes("relation") && !checkErr.message?.includes("growthmind_video_assets")) {
    console.error("Unexpected check error:", checkErr.message);
    process.exit(1);
  }

  console.log("Table missing — proceeding with migration.\n");
}

// ── Step 2: Try Management API if access token is set ─────────────────────────
if (projectRef && mgmtToken) {
  console.log("Applying via Supabase Management API...");
  const res  = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${mgmtToken}`,
    },
    body: JSON.stringify({ query: SQL }),
  });
  const json = await res.json();
  if (res.ok) {
    console.log("✅ growthmind_video_assets migration applied via Management API!");
    refreshSchemaMap();
    process.exit(0);
  }
  console.error("Management API error:", JSON.stringify(json));
}

// ── Step 3: Always print SQL instructions as fallback ─────────────────────────
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("⚠️  Apply this SQL in your Supabase project's SQL Editor:");
console.log("   supabase.com/dashboard → your project → SQL Editor → New query");
console.log("   Or set SUPABASE_ACCESS_TOKEN=sbp_... and re-run this script.");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
console.log(SQL);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
