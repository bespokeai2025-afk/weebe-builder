/**
 * Apply WBAH post-call queue + automation engine execution tables.
 *
 *   node scripts/apply-wbah-post-call-migration.mjs
 *
 * Requires SUPABASE_ACCESS_TOKEN + SUPABASE_URL (or VITE_SUPABASE_URL).
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const M = resolve(__dir, "../supabase/migrations");
const LOCK = "SET lock_timeout='8s';\n";

function loadDotenv() {
  try {
    for (const line of readFileSync(resolve(__dir, "../.env"), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* optional */
  }
}

loadDotenv();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mgmtToken = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

const STEPS = [
  "20260801110000_wbah_post_call_jobs.sql",
  "20260802120000_automation_workflow_executions.sql",
  "20260802140000_automation_engine_phase5.sql",
];

const TABLES = [
  "wbah_post_call_jobs",
  "automation_workflow_executions",
  "automation_execution_steps",
  "automation_execution_queue",
];

async function mgmtQuery(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mgmtToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 800)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function tablesPresent() {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const missing = [];
  for (const table of TABLES) {
    const { error } = await sb.from(table).select("id").limit(1);
    if (error) {
      const msg = error.message || "";
      if (
        error.code === "PGRST205" ||
        msg.includes("schema cache") ||
        msg.includes("does not exist") ||
        msg.includes("relation")
      ) {
        missing.push(table);
      }
    }
  }
  return missing;
}

console.log("=== WBAH post-call + automation engine migrations ===\n");

const missingBefore = await tablesPresent();
if (missingBefore?.length === 0) {
  console.log("✅ All tables already exist.");
  process.exit(0);
}
if (missingBefore?.length) {
  console.log("Missing tables:", missingBefore.join(", "));
}

if (!projectRef || !mgmtToken) {
  console.error("Missing SUPABASE_ACCESS_TOKEN or SUPABASE_URL — cannot apply via Management API.");
  console.log("\nApply these files manually in Supabase SQL Editor (in order):");
  for (const f of STEPS) console.log(`  - supabase/migrations/${f}`);
  process.exit(1);
}

for (const file of STEPS) {
  const sql = LOCK + readFileSync(resolve(M, file), "utf8");
  process.stdout.write(`▶ ${file} ... `);
  try {
    await mgmtQuery(sql);
    console.log("OK");
  } catch (e) {
    console.log("FAILED");
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  }
}

const missingAfter = await tablesPresent();
if (missingAfter?.length) {
  console.warn("\n⚠️  Still missing after apply:", missingAfter.join(", "));
  console.warn("PostgREST schema cache may need a minute to refresh. Restart dev server.");
} else {
  console.log("\n✅ All WBAH/automation tables verified.");
}

refreshSchemaMap();
console.log("\nDone. Restart `bun run dev` if errors persist (schema cache).");
