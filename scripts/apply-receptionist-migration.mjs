/**
 * Apply receptionist_tool_events migration.
 *
 *   node scripts/apply-receptionist-migration.mjs
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  resolve(__dir, "../supabase/migrations/20260811120000_receptionist_tool_events.sql"),
  "utf8",
);

function loadDotEnv() {
  try {
    for (const line of readFileSync(resolve(__dir, "../.env"), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

loadDotEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mgmtToken = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

if (SUPABASE_URL && SERVICE_KEY) {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { error } = await supabase.from("receptionist_tool_events").select("id").limit(1);
    if (!error) {
      console.log("✅ Table receptionist_tool_events already exists — nothing to do.");
      process.exit(0);
    }
  } catch (err) {
    console.warn("[receptionist-migration] check failed:", err?.message);
  }
}

if (projectRef && mgmtToken) {
  try {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mgmtToken}`,
        },
        body: JSON.stringify({ query: SQL }),
      },
    );
    const json = await res.json().catch(() => null);
    if (res.ok) {
      console.log("✅ receptionist_tool_events migration applied via Management API!");
      process.exit(0);
    }
    console.warn("[receptionist-migration] Management API error:", JSON.stringify(json));
  } catch (err) {
    console.warn("[receptionist-migration] network error:", err?.message);
  }
} else {
  console.warn("[receptionist-migration] SUPABASE_ACCESS_TOKEN not set — apply SQL manually.");
}

console.log("\nPaste this SQL in Supabase Dashboard → SQL Editor:\n");
console.log(SQL);
process.exit(0);
