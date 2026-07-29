/**
 * One-time migration: Task #489 — growthmind_content_variants table
 * (Content Studio cross-channel variants).
 *
 * Run: node scripts/apply-content-variants-migration.mjs
 * Always exits 0 — never blocks post-merge.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  resolve(__dir, "../supabase/migrations/20260726000000_growthmind_content_variants.sql"),
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
    const { error } = await supabase.from("growthmind_content_variants").select("id").limit(1);
    if (!error) {
      console.log("✅ Content variants migration already applied — nothing to do.");
      process.exit(0);
    }
    console.log("growthmind_content_variants missing — proceeding with migration.\n");
  } catch (err) {
    console.warn("[content-variants-migration] Check failed:", err?.message);
  }
} else {
  console.log("[content-variants-migration] No Supabase credentials found — printing SQL for manual apply.");
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
      console.log("✅ Content variants migration applied via Management API!");
      refreshSchemaMap();
      process.exit(0);
    }
    console.error("Management API apply failed:", res.status, JSON.stringify(json).slice(0, 500));
  } catch (err) {
    console.error("Management API apply error:", err?.message);
  }
}

console.log("\n── Manual apply SQL ─────────────────────────────────────────\n");
console.log(SQL);
process.exit(0);
