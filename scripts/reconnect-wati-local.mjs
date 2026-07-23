/**
 * Re-save WATI connection to Supabase (no UI, no webhook API call).
 * Use when Buzzchat Connect returns 503 but terminal WATI test works.
 *
 *   WATI_WORKSPACE_ID=9bc09fc9-5841-40d6-94a8-d3074a15f988 \
 *   WATI_TENANT_ID=1118754 \
 *   WATI_API_HOST=eu-api.wati.io \
 *   WATI_API_KEY='wati_...' \
 *   node scripts/reconnect-wati-local.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

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

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const workspaceId = process.env.WATI_WORKSPACE_ID?.trim() || "9bc09fc9-5841-40d6-94a8-d3074a15f988";
const tenantId = process.env.WATI_TENANT_ID?.trim() || "1118754";
const apiKey = process.env.WATI_API_KEY?.trim();
const apiHost = (process.env.WATI_API_HOST || "eu-api.wati.io").trim().replace(/^https?:\/\//, "").split("/")[0];

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
if (!apiKey) {
  console.error("Set WATI_API_KEY");
  process.exit(2);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Quick WATI ping
const testUrl = `https://${apiHost}/${tenantId}/api/v1/getContacts?pageSize=1`;
const testRes = await fetch(testUrl, {
  headers: {
    Authorization: `Bearer ${apiKey.replace(/^Bearer\s+/i, "")}`,
    "Content-Type": "application/json",
  },
});
if (!testRes.ok) {
  console.error(`WATI test failed HTTP ${testRes.status}`);
  process.exit(1);
}
console.log("✅ WATI API OK");

const now = new Date().toISOString();
const { error } = await sb.from("wati_connections").upsert(
  {
    workspace_id: workspaceId,
    api_key: apiKey,
    tenant_id: tenantId,
    api_host: apiHost,
    webhook_secret: null,
    status: "connected",
    last_tested_at: now,
    error_message: null,
    updated_at: now,
  },
  { onConflict: "workspace_id" },
);
if (error) {
  console.error("❌ DB upsert failed:", error.message);
  process.exit(1);
}

await sb.from("wati_sync_logs").insert({
  workspace_id: workspaceId,
  sync_type: "test",
  status: "success",
  records_synced: 0,
});

console.log(`✅ WATI reconnected for workspace ${workspaceId}`);
console.log(`   api_host: ${apiHost}`);
console.log("\nWebhook stays in WATI dashboard (manual). Webee won't show it — that's normal.");
console.log("Refresh Buzzchat → Settings — should show Connected.");
