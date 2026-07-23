/**
 * Test WATI credentials locally (does not write to DB).
 *
 *   WATI_TENANT_ID=1118754 WATI_API_KEY='eyJ...' node scripts/test-wati-credentials.mjs
 *
 * Optional: WATI_API_BASE=https://live-mt-server.wati.io/1118754/api/v1
 *           (copy exact base from WATI → API Docs if different)
 */
const tenantId = process.env.WATI_TENANT_ID?.trim();
const apiKey = process.env.WATI_API_KEY?.trim();
const customBase = process.env.WATI_API_BASE?.trim()?.replace(/\/$/, "");

if (!tenantId || !apiKey) {
  console.error("Set WATI_TENANT_ID and WATI_API_KEY in the environment.");
  console.error("Example:");
  console.error("  WATI_TENANT_ID=1118754 WATI_API_KEY='eyJ...' node scripts/test-wati-credentials.mjs");
  process.exit(2);
}

if (apiKey.startsWith("Bearer ")) {
  console.warn("⚠️  Remove 'Bearer ' from WATI_API_KEY — paste the JWT only.\n");
}

const bases = customBase
  ? [customBase]
  : [
      `https://eu-api.wati.io/${tenantId}/api/v1`,
      `https://live-mt-server.wati.io/${tenantId}/api/v1`,
    ];

async function probe(label, url) {
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey.replace(/^Bearer\s+/i, "")}`,
        "Content-Type": "application/json",
      },
    });
    const text = await res.text();
    let snippet = text.slice(0, 200).replace(/\s+/g, " ");
    if (res.ok && text.trimStart().startsWith("<!")) {
      snippet = "HTML page (wrong host — not the WATI API)";
    } else if (res.status === 401) snippet = "Unauthorized — token invalid or expired";
    if (res.status === 403) snippet = "Forbidden — token lacks contacts:read scope";
    if (res.status === 404) snippet = "Not found — wrong tenant ID or API host";
    console.log(`${label}`);
    console.log(`  URL: ${url}`);
    console.log(`  HTTP ${res.status} — ${snippet}\n`);
    return res.status;
  } catch (e) {
    console.log(`${label}`);
    console.log(`  URL: ${url}`);
    console.log(`  Network error: ${(e).message}\n`);
    return 0;
  }
}

console.log(`Tenant ID: ${tenantId}`);
console.log(`Token length: ${apiKey.length} chars\n`);

for (const base of bases) {
  await probe("GET getContacts?pageSize=1", `${base}/getContacts?pageSize=1`);
}

console.log("── What to do ──");
console.log("• 401 → WATI → API Docs → copy a NEW Bearer token (password change invalidates old ones)");
console.log("• 404 → copy the full API Endpoint URL from API Docs → set WATI_API_BASE to that path");
console.log("• 200 → use the same tenant + token in Buzzchat → Settings → WATI → Connect");
