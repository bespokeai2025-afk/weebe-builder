/**
 * One-time migration: GrowthMind Video Anatomy (Phase 3).
 *   growthmind_content_anatomy table, discovery_runs run_kind extension,
 *   workspace_settings.growthmind_deep_analysis_daily_limit.
 *
 * Run: node scripts/apply-growthmind-video-anatomy-migration.mjs
 * Always exits 0 — never blocks post-merge.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  resolve(__dir, "../supabase/migrations/20260824000000_growthmind_video_anatomy.sql"),
  "utf8",
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mgmtToken    = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef   = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

// ── Step 1: already applied? ──────────────────────────────────────────────────
if (SUPABASE_URL && SERVICE_KEY) {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { error: tErr } = await supabase.from("growthmind_content_anatomy").select("id").limit(1);
    const { error: cErr } = await supabase.from("workspace_settings").select("growthmind_deep_analysis_daily_limit").limit(1);
    if (!tErr && !cErr) {
      console.log("✅ GrowthMind Video Anatomy migration already applied — nothing to do.");
      process.exit(0);
    }
    console.log("Video Anatomy tables/columns missing — proceeding with migration.\n");
  } catch (err) {
    console.warn("[gm-va-migration] Check failed:", err?.message);
  }
} else {
  console.log("[gm-va-migration] No Supabase credentials found — printing SQL for manual apply.");
}

// ── Step 2: Management API apply ──────────────────────────────────────────────
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
      console.log("✅ GrowthMind Video Anatomy migration applied via Management API!");
      refreshSchemaMap();
      process.exit(0);
    }
    console.warn("[gm-va-migration] Management API error:", JSON.stringify(json));
  } catch (err) {
    console.warn("[gm-va-migration] Management API network error:", err?.message);
  }
}

// ── Step 3: Print SQL fallback ────────────────────────────────────────────────
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("⚠️  Apply this SQL in your Supabase project's SQL Editor:");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
console.log(SQL);
process.exit(0);
