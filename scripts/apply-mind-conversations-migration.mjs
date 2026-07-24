/**
 * One-time migration: mind_conversations + mind_conversation_messages
 * (server-side Mind conversation persistence).
 *
 * Run: node scripts/apply-mind-conversations-migration.mjs
 * Always exits 0 — never blocks post-merge.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
// Both migrations are idempotent and MUST be applied together: the second one
// replaces the initial workspace-members RLS with per-user owner policies and
// adds the unique active-conversation index. Applying only the first would
// leave private chats readable by other workspace members.
const SQL = [
  "20260724100000_mind_conversations.sql",
  "20260724120000_mind_conversations_user_rls.sql",
]
  .map((f) => readFileSync(resolve(__dir, "../supabase/migrations/", f), "utf8"))
  .join("\n");

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mgmtToken    = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef   = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

const TABLES = ["mind_conversations", "mind_conversation_messages"];

if (SUPABASE_URL && SERVICE_KEY) {
  let supabase;
  try {
    supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  } catch (err) {
    console.warn("[mconv-migration] Failed to create Supabase client:", err?.message);
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
        console.warn(`[mconv-migration] Unexpected check error on ${table}: ${error.message}`);
        console.log("Skipping migration check to avoid blocking post-merge.");
        process.exit(0);
      }
    } catch (err) {
      console.warn(`[mconv-migration] Network error checking ${table}:`, err?.message);
      console.log("Skipping migration check to avoid blocking post-merge.");
      process.exit(0);
    }
  }

  if (allPresent) {
    // Tables exist but the RLS-tightening migration may not have run — the
    // whole SQL bundle is idempotent, so re-apply it to guarantee per-user
    // owner policies + the unique active-conversation index are in place.
    console.log("mind_conversations tables exist — re-applying idempotent SQL to ensure per-user RLS.");
  } else {
    console.log("mind_conversations tables missing — proceeding with migration.\n");
  }
} else {
  console.log("[mconv-migration] No Supabase credentials found — printing SQL for manual apply.");
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
      console.log("✅ mind_conversations migration applied via Management API!");
      refreshSchemaMap();
      process.exit(0);
    }
    console.warn("[mconv-migration] Management API error:", JSON.stringify(json));
  } catch (err) {
    console.warn("[mconv-migration] Management API network error:", err?.message);
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
