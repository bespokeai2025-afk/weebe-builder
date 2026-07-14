/**
 * One-time migration: campaign notifications + team access (RBAC) tables.
 * Run: node scripts/apply-notifications-team-access-migration.mjs
 * Always exits 0 — never blocks post-merge.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  resolve(__dir, "../supabase/migrations/20260714000000_notifications_team_access.sql"),
  "utf8",
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mgmtToken    = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef   = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

const TABLES = [
  "workspace_notification_settings",
  "workspace_notifications",
  "workspace_role_permissions",
  "workspace_member_roles",
  "workspace_approval_settings",
  "workspace_access_audit_logs",
];

if (SUPABASE_URL && SERVICE_KEY) {
  let supabase;
  try {
    supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  } catch (err) {
    console.warn("[nta-migration] Failed to create Supabase client:", err?.message);
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
        console.warn(`[nta-migration] Unexpected check error on ${table}: ${error.message}`);
        console.log("Skipping migration check to avoid blocking post-merge.");
        process.exit(0);
      }
    } catch (err) {
      console.warn(`[nta-migration] Network error checking ${table}:`, err?.message);
      console.log("Skipping migration check to avoid blocking post-merge.");
      process.exit(0);
    }
  }

  if (allPresent) {
    // Also verify the additive invites column exists.
    const { error: invErr } = await supabase.from("workspace_invites").select("invited_role_key").limit(1);
    if (!invErr) {
      console.log("✅ notifications/team-access tables already exist — nothing to do.");
      process.exit(0);
    }
  }

  console.log("Notifications/team-access tables missing — proceeding with migration.\n");
} else {
  console.log("[nta-migration] No Supabase credentials found — printing SQL for manual apply.");
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
      console.log("✅ notifications/team-access migration applied via Management API!");
      refreshSchemaMap();
      process.exit(0);
    }
    console.warn("[nta-migration] Management API error:", JSON.stringify(json));
  } catch (err) {
    console.warn("[nta-migration] Management API network error:", err?.message);
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
