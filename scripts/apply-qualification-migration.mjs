/**
 * One-time migration: adds qualification columns to the leads table.
 * Run: node scripts/apply-qualification-migration.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// Check if columns already exist
const { data: existingCols, error: checkErr } = await supabase
  .from("leads")
  .select("qualification_status, qualification_score, budget_confirmed, decision_maker, urgency, interest_level, next_step")
  .limit(1);

if (!checkErr) {
  console.log("✅ Qualification columns already exist on leads table — nothing to do.");
  process.exit(0);
}

if (!checkErr?.message?.includes("does not exist")) {
  console.error("Unexpected check error:", checkErr?.message);
  process.exit(1);
}

// Try to apply via PostgREST /rpc/exec_sql if available, else log instructions
console.log("Columns missing. Attempting to apply migration via Supabase...");

const SQL = `
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS qualification_status   TEXT,
  ADD COLUMN IF NOT EXISTS qualification_score    INTEGER,
  ADD COLUMN IF NOT EXISTS budget_confirmed       BOOLEAN,
  ADD COLUMN IF NOT EXISTS decision_maker         BOOLEAN,
  ADD COLUMN IF NOT EXISTS urgency                TEXT,
  ADD COLUMN IF NOT EXISTS interest_level         TEXT,
  ADD COLUMN IF NOT EXISTS next_step              TEXT;
CREATE INDEX IF NOT EXISTS leads_qualification_status_idx ON public.leads(workspace_id, qualification_status);
`;

// Try via raw HTTP to Management API
const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
if (!projectRef) {
  console.error("Could not extract project ref from URL");
} else {
  const mgmtToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (mgmtToken) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${mgmtToken}`,
      },
      body: JSON.stringify({ query: SQL }),
    });
    const json = await res.json();
    if (res.ok) {
      console.log("✅ Migration applied successfully via Management API!");
      refreshSchemaMap();
      process.exit(0);
    } else {
      console.error("Management API error:", JSON.stringify(json));
    }
  }
}

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("⚠️  Could not apply migration automatically.");
console.log("Please run the following SQL in your Supabase dashboard:");
console.log("  Project → SQL Editor → paste and run:");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
console.log(SQL);
console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
