/**
 * One-time migration: conversion_events ledger + click-ID attribution columns.
 *
 * Run: node scripts/apply-conversion-tracking-migration.mjs
 * Always exits 0 — never blocks post-merge.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  resolve(__dir, "../supabase/migrations/20260920200000_conversion_tracking.sql"),
  "utf8",
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mgmtToken    = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef   = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

function printFallback() {
  console.log("\n[conversion-tracking-migration] Apply manually via Supabase SQL editor:");
  console.log("supabase/migrations/20260920200000_conversion_tracking.sql\n");
}

async function alreadyApplied() {
  if (!SUPABASE_URL || !SERVICE_KEY) return false;
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const [{ error: tableErr }, { error: colErr }] = await Promise.all([
      supabase.from("conversion_events").select("id").limit(1),
      supabase.from("leads").select("gclid").limit(1),
    ]);
    return !tableErr && !colErr;
  } catch {
    return false;
  }
}

if (await alreadyApplied()) {
  console.log("[conversion-tracking-migration] Already applied — nothing to do.");
  process.exit(0);
}

if (!mgmtToken || !projectRef) {
  console.warn("[conversion-tracking-migration] SUPABASE_ACCESS_TOKEN or project ref missing.");
  printFallback();
  process.exit(0);
}

try {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${mgmtToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: SQL }),
  });
  if (!res.ok) {
    console.error("[conversion-tracking-migration] Failed:", res.status, (await res.text()).slice(0, 500));
    printFallback();
    process.exit(0);
  }
  console.log("[conversion-tracking-migration] Applied successfully.");
  if (await alreadyApplied()) {
    console.log("[conversion-tracking-migration] Verified: table + columns present.");
  } else {
    console.warn("[conversion-tracking-migration] Verification inconclusive — check manually.");
  }
  try { await refreshSchemaMap(); } catch { /* best-effort */ }
} catch (err) {
  console.error("[conversion-tracking-migration] Error:", err?.message);
  printFallback();
}
process.exit(0);
