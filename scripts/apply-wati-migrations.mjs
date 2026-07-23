/**
 * Apply WATI Supabase migrations only (no WATI API calls).
 * Run: node scripts/apply-wati-migrations.mjs
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  try {
    const raw = readFileSync(resolve(__dir, "../.env"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 1) continue;
      const key = t.slice(0, i);
      let val = t.slice(i + 1).trim();
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

loadDotEnv();

const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
if (!token) {
  console.error("Missing SUPABASE_ACCESS_TOKEN in .env");
  process.exit(2);
}
if (!url) {
  console.error("Missing SUPABASE_URL in .env");
  process.exit(2);
}

const projectRef = new URL(url).host.split(".")[0];
const LOCK = "SET lock_timeout='8s';\n";
const files = [
  "20260614000000_wati_connector.sql",
  "20260720120000_wati_leads_crm.sql",
  "20260722160000_wati_api_host.sql",
  "20260723100000_wati_template_status.sql",
  "20260723120000_wati_webhook_manual.sql",
];

for (const file of files) {
  const sql = LOCK + readFileSync(resolve(__dir, "../supabase/migrations", file), "utf8");
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`❌ ${file}: HTTP ${res.status}`);
    console.error(text.slice(0, 500));
    process.exit(1);
  }
  console.log(`✅ ${file}`);
}

refreshSchemaMap();
console.log("\nDone — WATI database tables are ready.");
