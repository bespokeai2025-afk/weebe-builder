/**
 * One-time migration: creates the SystemMind Generators detail tables.
 *   whatsapp_setup_drafts
 *   follow_up_sequence_drafts
 *   workflow_blueprints
 *
 * Run: node scripts/apply-systemmind-generators-migration.mjs
 *
 * Env vars:
 *   SUPABASE_ACCESS_TOKEN — Supabase personal access token (sbp_...) for Management API
 *   SUPABASE_URL / VITE_SUPABASE_URL — project URL (existence check)
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (existence check)
 *
 * Always exits 0 — never blocks post-merge regardless of credential/network state.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  resolve(__dir, "../supabase/migrations/20260811000000_systemmind_generators.sql"),
  "utf8",
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mgmtToken    = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef   = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

const TABLES = [
  "whatsapp_setup_drafts",
  "follow_up_sequence_drafts",
  "workflow_blueprints",
];

// ── Step 1: Check all tables exist before declaring "already applied" ────────
if (SUPABASE_URL && SERVICE_KEY) {
  let supabase;
  try {
    supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  } catch (err) {
    console.warn("[sm-generators-migration] Failed to create Supabase client:", err?.message);
    printFallback();
    process.exit(0);
  }

  let allPresent = true;
  for (const table of TABLES) {
    try {
      const { error } = await supabase.from(table).select("id").limit(1);
      if (error) {
        const isMissing =
          error.code === "PGRST205" ||
          (error.message || "").includes("relation") ||
          (error.message || "").includes("does not exist") ||
          (error.message || "").includes(table);
        if (isMissing) { allPresent = false; break; }
        console.warn(`[sm-generators-migration] Unexpected check error on ${table}: ${error.message}`);
        console.log("Skipping migration check to avoid blocking post-merge.");
        process.exit(0);
      }
    } catch (err) {
      console.warn(`[sm-generators-migration] Network error checking ${table}:`, err?.message);
      console.log("Skipping migration check to avoid blocking post-merge.");
      process.exit(0);
    }
  }

  if (allPresent) {
    console.log("✅ All SystemMind Generators tables already exist — nothing to do.");
    process.exit(0);
  }

  console.log("One or more generator tables missing — proceeding with migration.\n");
} else {
  console.log("[sm-generators-migration] No Supabase credentials found — printing SQL for manual apply.");
}

// ── Step 2: Try Management API if access token is set ────────────────────────
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
      console.log("✅ SystemMind Generators migration applied via Management API!");
      refreshSchemaMap();
      process.exit(0);
    }
    console.warn("[sm-generators-migration] Management API error:", JSON.stringify(json));
  } catch (err) {
    console.warn("[sm-generators-migration] Management API network error:", err?.message);
  }
}

// ── Step 3: Print SQL as fallback — never blocks ─────────────────────────────
printFallback();
process.exit(0);

function printFallback() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("⚠️  Apply this SQL in your Supabase project's SQL Editor:");
  console.log("   supabase.com/dashboard → your project → SQL Editor → New query");
  console.log("   Or set SUPABASE_ACCESS_TOKEN=sbp_... and re-run this script.");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log(SQL);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}
