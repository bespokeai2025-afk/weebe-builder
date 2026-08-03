#!/usr/bin/env node
/**
 * Smoke-test Dynamics OAuth + optional GET/PATCH for a WBAH test lead.
 * Usage:
 *   node scripts/test-dynamics-oauth.mjs
 *   node scripts/test-dynamics-oauth.mjs --lead d4ffa937-998d-f111-ab10-7ced8d460595
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const path = resolve(process.cwd(), ".env");
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* optional */
  }
}

loadEnv();

const leadArg = process.argv.find((a) => a.startsWith("--lead="))?.split("=")[1]
  ?? (process.argv.includes("--lead") ? process.argv[process.argv.indexOf("--lead") + 1] : null);

const tenantId = process.env.DYNAMICS_TENANT_ID?.trim();
const clientId = process.env.DYNAMICS_CLIENT_ID?.trim();
const clientSecret = process.env.DYNAMICS_CLIENT_SECRET?.trim();
let orgUrl = process.env.DYNAMICS_ORG_URL?.trim() ?? "";
if (!orgUrl) {
  const resource = process.env.DYNAMICS_RESOURCE?.trim() ?? "";
  orgUrl = resource.replace(/\/\.default$/i, "");
}
if (!orgUrl) {
  orgUrl = (process.env.DYNAMICS_BASE_URL ?? "").replace(/\/api\/data\/v[\d.]+$/i, "");
}

if (!tenantId || !clientId || !clientSecret || !orgUrl) {
  console.error("Missing DYNAMICS_* env vars in .env");
  process.exit(1);
}

const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
const tokenRes = await fetch(tokenUrl, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: `${orgUrl.replace(/\/+$/, "")}/.default`,
    grant_type: "client_credentials",
  }),
});
const tokenJson = await tokenRes.json();
if (!tokenJson.access_token) {
  console.error("OAuth FAILED:", tokenJson.error ?? tokenRes.status);
  console.error((tokenJson.error_description ?? "").slice(0, 400));
  process.exit(1);
}
console.log("OAuth OK");

const headers = {
  Authorization: `Bearer ${tokenJson.access_token}`,
  Accept: "application/json",
  "OData-MaxVersion": "4.0",
  "OData-Version": "4.0",
};

const who = await fetch(`${orgUrl.replace(/\/+$/, "")}/api/data/v9.2/WhoAmI`, { headers });
console.log("WhoAmI:", who.status, who.ok ? "OK" : (await who.text()).slice(0, 200));

if (leadArg) {
  const url = `${orgUrl.replace(/\/+$/, "")}/api/data/v9.2/leads(${leadArg})?$select=leadid,new_currentstatus,new_propinfo_street2,new_propinfo_postalcode,cos_call_summary`;
  const res = await fetch(url, { headers });
  console.log("GET lead:", res.status);
  console.log((await res.text()).slice(0, 600));
}
