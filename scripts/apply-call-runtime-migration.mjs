/**
 * One-time migration: SystemMind call runtime tables (Task #460 expanded)
 *   systemmind_call_triggers, systemmind_call_queue, systemmind_call_attempts,
 *   systemmind_workflow_executions, systemmind_execution_steps,
 *   systemmind_integration_errors, systemmind_workflow_activations
 *
 * Run: node scripts/apply-call-runtime-migration.mjs
 * Always exits 0 — never blocks post-merge regardless of credential/network state.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  resolve(__dir, "../supabase/migrations/20260724130000_systemmind_call_runtime.sql"),
  "utf8",
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mgmtToken = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

const TABLES = [
  "systemmind_call_triggers",
  "systemmind_call_queue",
  "systemmind_call_attempts",
  "systemmind_workflow_executions",
  "systemmind_execution_steps",
  "systemmind_integration_errors",
  "systemmind_workflow_activations",
];

if (SUPABASE_URL && SERVICE_KEY) {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    let allPresent = true;
    for (const table of TABLES) {
      const { error } = await supabase.from(table).select("id").limit(1);
      if (error) { allPresent = false; break; }
    }
    if (allPresent) {
      console.log("✅ Call runtime tables already exist — nothing to do.");
      process.exit(0);
    }
  } catch (err) {
    console.warn("[call-runtime-migration] check failed:", err?.message);
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
      console.log("✅ Call runtime migration applied via Management API!");
      process.exit(0);
    }
    console.warn("[call-runtime-migration] Management API error:", JSON.stringify(json));
  } catch (err) {
    console.warn("[call-runtime-migration] network error:", err?.message);
  }
} else {
  console.warn("[call-runtime-migration] Missing SUPABASE_ACCESS_TOKEN or project ref — apply supabase/migrations/20260724130000_systemmind_call_runtime.sql manually.");
}
process.exit(0);
