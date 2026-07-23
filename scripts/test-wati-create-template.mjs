/**
 * Test WATI create template API (POST /api/v1/whatsApp/templates).
 *
 *   WATI_DRY_RUN=1 node scripts/test-wati-create-template.mjs
 *
 * Live (uses .env or wati_connections row):
 *   WATI_TENANT_ID=1118754 WATI_API_HOST=eu-api.wati.io WATI_API_KEY='wati_...' \
 *   node scripts/test-wati-create-template.mjs
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

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

const tenantId = process.env.WATI_TENANT_ID?.trim() || "1118754";
const apiHost = (process.env.WATI_API_HOST || "eu-api.wati.io").replace(/^https?:\/\//, "").split("/")[0];
const workspaceId = process.env.WATI_WORKSPACE_ID?.trim() || "9bc09fc9-5841-40d6-94a8-d3074a15f988";
let apiKey = process.env.WATI_API_KEY?.trim();
const dryRun = process.env.WATI_DRY_RUN === "1";
const elementName = process.env.WATI_TEST_ELEMENT?.trim() || `webee_test_${Date.now()}`;

if (!apiKey && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data } = await sb
    .from("wati_connections")
    .select("api_key, tenant_id, api_host")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected")
    .maybeSingle();
  apiKey = data?.api_key;
  if (data?.tenant_id) process.env.WATI_TENANT_ID = data.tenant_id;
  if (data?.api_host) process.env.WATI_API_HOST = data.api_host;
}

if (!apiKey && !dryRun) {
  console.error("Set WATI_API_KEY or connect WATI in DB, or use WATI_DRY_RUN=1");
  process.exit(2);
}

const payload = {
  type: "template",
  category: "UTILITY",
  subCategory: "STANDARD",
  buttonsType: "NONE",
  buttons: [],
  elementName,
  language: "en",
  header: { type: 0, headerTypeString: "none", typeString: "none" },
  body: "Hi {{name}}, this is a Webee test template. Please ignore.",
  footer: "Avenue Elite Properties",
  customParams: [{ paramName: "name", paramValue: "Customer" }],
  creationMethod: 0,
};

const url = `https://${apiHost}/${tenantId}/api/v1/whatsApp/templates`;

console.log("Create URL:", url);
console.log("Element name:", elementName);
console.log("Payload:", JSON.stringify(payload, null, 2));

if (dryRun) {
  console.log("\nWATI_DRY_RUN=1 — skipping HTTP POST");
  process.exit(0);
}

const res = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey.replace(/^Bearer\s+/i, "")}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

const text = await res.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  json = { raw: text.slice(0, 500) };
}

console.log("\nHTTP", res.status);
console.log(JSON.stringify(json, null, 2));

if (!res.ok) {
  process.exit(1);
}

const result = json.result ?? json;
const status = result?.status?.newStatus ?? result?.statusCode;
console.log("\nTemplate status code:", status, status === 0 ? "(DRAFT)" : status === 1 ? "(PENDING)" : "");
