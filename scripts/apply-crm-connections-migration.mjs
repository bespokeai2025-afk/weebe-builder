/**
 * One-time migration: SystemMind CRM connections tables (Task #457)
 *   systemmind_crm_connections, systemmind_crm_discoveries
 *
 * Run: node scripts/apply-crm-connections-migration.mjs
 * Always exits 0 — never blocks post-merge regardless of credential/network state.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  resolve(__dir, "../supabase/migrations/20260724000000_systemmind_crm_connections.sql"),
  "utf8",
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mgmtToken = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

const TABLES = ["systemmind_crm_connections", "systemmind_crm_discoveries"];

if (SUPABASE_URL && SERVICE_KEY) {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    let allPresent = true;
    for (const table of TABLES) {
      const { error } = await supabase.from(table).select("id").limit(1);
      if (error) { allPresent = false; break; }
    }
    if (allPresent) {
      console.log("✅ CRM connections tables already exist — nothing to do.");
      process.exit(0);
    }
  } catch (err) {
    console.warn("[crm-connections-migration] check failed:", err?.message);
  }
}

if (projectRef && mgmtToken) {
  try {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${mgmtToken}` },
        body: JSON.stringify({ query: SQL }),
      },
    );
    const json = await res.json().catch(() => null);
    if (res.ok) {
      console.log("✅ CRM connections migration applied via Management API!");
      process.exit(0);
    }
    console.warn("[crm-connections-migration] Management API error:", JSON.stringify(json));
  } catch (err) {
    console.warn("[crm-connections-migration] network error:", err?.message);
  }
} else {
  console.warn("[crm-connections-migration] Missing SUPABASE_ACCESS_TOKEN or project ref — apply supabase/migrations/20260724000000_systemmind_crm_connections.sql manually.");
}
process.exit(0);
