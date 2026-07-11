/**
 * One-time migration: widens entity_notes.entity_id from UUID to TEXT so
 * notes work for synthetic non-UUID entity ids (WBAH-derived leads/contacts/
 * calls, CRM-only booked contacts, etc.), not just real UUID rows.
 *
 * Run: node scripts/apply-entity-notes-text-migration.mjs
 *
 * Env vars:
 *   SUPABASE_ACCESS_TOKEN — Supabase personal access token (sbp_...) for
 *                           Management API; get at supabase.com/dashboard/account/tokens
 *   SUPABASE_URL / VITE_SUPABASE_URL — project URL
 *   SUPABASE_SERVICE_ROLE_KEY — project service role key (needed for existence check)
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
  resolve(__dir, "../supabase/migrations/20260803000000_entity_notes_text_entity_id.sql"),
  "utf8",
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mgmtToken    = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef   = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

// ── Step 1: Check if already applied (entity_id already TEXT) ────────────────
if (SUPABASE_URL && SERVICE_KEY) {
  let supabase;
  try {
    supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  } catch (err) {
    console.warn("[entity-notes-migration] Failed to create Supabase client:", err?.message);
    printFallback();
    process.exit(0);
  }

  try {
    // A non-UUID string insert (immediately deleted) proves the column already accepts TEXT.
    const probeId = "migration-probe:non-uuid";
    const { error: insertErr } = await supabase
      .from("entity_notes")
      .insert({
        workspace_id: "00000000-0000-0000-0000-000000000000",
        entity_type: "lead",
        entity_id: probeId,
        body: "migration probe — safe to ignore/delete",
      });
    if (!insertErr) {
      // Somehow inserted (shouldn't happen — workspace FK should reject), clean up just in case.
      await supabase.from("entity_notes").delete().eq("entity_id", probeId);
      console.log("✅ entity_notes.entity_id already accepts non-UUID text — nothing to do.");
      process.exit(0);
    }
    const msg = (insertErr.message || "").toLowerCase();
    const isUuidTypeError = msg.includes("invalid input syntax for type uuid");
    if (!isUuidTypeError) {
      console.log("✅ entity_notes.entity_id already accepts non-UUID text (failed for other reason: " + insertErr.message + ") — nothing to do.");
      process.exit(0);
    }
    console.log("entity_notes.entity_id is still UUID-typed — proceeding with migration.\n");
  } catch (err) {
    console.warn("[entity-notes-migration] Network error during check:", err?.message);
    console.log("Skipping migration check to avoid blocking post-merge.");
    process.exit(0);
  }
} else {
  console.log("[entity-notes-migration] No Supabase credentials found — printing SQL for manual apply.");
}

// ── Step 2: Try Management API if access token is set ─────────────────────────
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
      console.log("✅ entity_notes.entity_id widened to TEXT via Management API!");
      refreshSchemaMap();
      process.exit(0);
    }
    console.warn("[entity-notes-migration] Management API error:", JSON.stringify(json));
  } catch (err) {
    console.warn("[entity-notes-migration] Management API network error:", err?.message);
  }
}

// ── Step 3: Print SQL as fallback — never blocks ──────────────────────────────
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
