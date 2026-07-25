/**
 * Migration: work_orders + mind_task_executions + task/action linkage columns
 * (Workstream 1 — unified work-order / execution backbone).
 *
 * Run: node scripts/apply-work-orders-migration.mjs
 * Always exits 0 — never blocks post-merge. Idempotent SQL, safe to re-run.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  resolve(__dir, "../supabase/migrations/20260919100000_work_orders_and_executions.sql"),
  "utf8",
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const mgmtToken    = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef   = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

if (projectRef && mgmtToken) {
  console.log("Applying work-orders migration via Supabase Management API...");
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
      console.log("✅ work-orders migration applied via Management API!");
      refreshSchemaMap();
      process.exit(0);
    }
    console.warn("[work-orders-migration] Management API error:", JSON.stringify(json));
  } catch (err) {
    console.warn("[work-orders-migration] Management API network error:", err?.message);
  }
}

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("⚠️  Apply this SQL in your Supabase project's SQL Editor:");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
console.log(SQL);
process.exit(0);
