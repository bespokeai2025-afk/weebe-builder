/**
 * One-time migration: HiveMind executive control over GrowthMind —
 * growthmind_objectives table + workspace_settings pause/cost-limit columns.
 *
 * Run: node scripts/apply-growthmind-executive-control-migration.mjs
 * Always exits 0 — never blocks post-merge.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  resolve(__dir, "../supabase/migrations/20260724180000_growthmind_executive_control.sql"),
  "utf8",
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mgmtToken    = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef   = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

function printFallback() {
  console.log("[gm-exec-control-migration] Apply manually in the Supabase SQL editor:");
  console.log("  supabase/migrations/20260724180000_growthmind_executive_control.sql");
}

let alreadyApplied = false;
if (SUPABASE_URL && SERVICE_KEY) {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const [{ error: tErr }, { error: cErr }] = await Promise.all([
      supabase.from("growthmind_objectives").select("id").limit(1),
      supabase.from("workspace_settings").select("growthmind_publishing_paused").limit(1),
    ]);
    alreadyApplied = !tErr && !cErr;
  } catch { /* treat as missing */ }
}

if (alreadyApplied) {
  console.log("[gm-exec-control-migration] Already applied — nothing to do.");
  process.exit(0);
}

if (!mgmtToken || !projectRef) {
  printFallback();
  process.exit(0);
}

try {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${mgmtToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: SQL }),
  });
  if (res.ok || res.status === 201) {
    console.log("[gm-exec-control-migration] Applied successfully.");
    try { await refreshSchemaMap(); } catch { /* best-effort */ }
  } else {
    console.warn("[gm-exec-control-migration] Mgmt API returned", res.status, (await res.text()).slice(0, 500));
    printFallback();
  }
} catch (err) {
  console.warn("[gm-exec-control-migration] Failed:", err?.message);
  printFallback();
}
process.exit(0);
