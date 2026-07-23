/**
 * Test WATI V3 template send (single recipient, dry-run friendly).
 *
 *   WATI_TENANT_ID=1118754 WATI_API_HOST=eu-api.wati.io WATI_API_KEY='wati_...' \
 *   WATI_TEST_PHONE=447746107812 WATI_TEST_TEMPLATE=new_chat_v1 \
 *   node scripts/test-wati-v3-send.mjs
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
const phone = (process.env.WATI_TEST_PHONE || "447746107812").replace(/\D/g, "");
const templateName = process.env.WATI_TEST_TEMPLATE?.trim() || "new_chat_v1";
const dryRun = process.env.WATI_DRY_RUN === "1";

if (!apiKey && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data } = await sb
    .from("wati_connections")
    .select("api_key")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected")
    .maybeSingle();
  apiKey = data?.api_key;
}

if (!apiKey) {
  console.error("Set WATI_API_KEY or connect WATI in DB");
  process.exit(2);
}

const url = `https://${apiHost}/${tenantId}/api/ext/v3/messageTemplates/send`;
const body = {
  channel: null,
  template_name: templateName,
  broadcast_name: "webee_v3_test",
  recipients: [
    {
      phone_number: phone,
      custom_params: [{ name: "name", value: "Test" }],
    },
  ],
};

console.log("V3 URL:", url);
console.log("Body:", JSON.stringify(body, null, 2));

if (dryRun) {
  console.log("\nDRY RUN — set WATI_DRY_RUN=0 to send");
  process.exit(0);
}

const res = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey.replace(/^Bearer\s+/i, "")}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const text = await res.text();
console.log("\nHTTP", res.status);
console.log(text.slice(0, 800));
