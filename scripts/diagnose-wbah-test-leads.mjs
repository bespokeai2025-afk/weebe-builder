#!/usr/bin/env bun
/**
 * Diagnose why Test Lead rows aren't updating in WEBEE People tab.
 * Reads .env (WEBESPOKE_*), hits local/cloud UAT API directly.
 *
 * Usage: bun scripts/diagnose-wbah-test-leads.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

function parseDotenv(filePath) {
  const out = {};
  try {
    for (const line of readFileSync(filePath, "utf8").split("\n")) {
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
      out[key] = val;
    }
  } catch {
    /* ignore */
  }
  return out;
}

const env = parseDotenv(join(process.cwd(), ".env"));
const base = (env.WEBESPOKE_API_BASE_URL || "https://uat-api.webespokeai.com").replace(/\/$/, "");
const email = env.WEBESPOKE_ADMIN_EMAIL;
const password = env.WEBESPOKE_ADMIN_PASSWORD;

if (!email || !password) {
  console.error("Missing WEBESPOKE_ADMIN_EMAIL or WEBESPOKE_ADMIN_PASSWORD in .env");
  process.exit(1);
}

console.log("UAT base URL:", base);
console.log("Admin email:", email);

async function api(path, opts = {}) {
  const url = `${base}${path}`;
  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text.slice(0, 300);
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

function bearer(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function unwrapAuth(body) {
  const inner = body?.data && typeof body.data === "object" ? body.data : body;
  return inner?.accessToken ?? inner?.token ?? inner?.access_token ?? null;
}

function unwrapEnvelope(body) {
  if (body?.data && typeof body.data === "object" && !Array.isArray(body.data)) return body.data;
  return body;
}

// 1. Login
const login = await api("/admin/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});

if (!login.ok || login.data?.result === false) {
  console.error("\n❌ Login FAILED:", login.error ?? login.data?.message ?? login.status);
  console.error("   Fix WEBESPOKE_ADMIN_EMAIL/PASSWORD for THIS UAT instance (local vs cloud differ).");
  process.exit(1);
}

const token = unwrapAuth(login.data);
if (!token) {
  console.error("\n❌ Login response had no accessToken:", JSON.stringify(login.data).slice(0, 200));
  process.exit(1);
}
console.log("\n✅ Login OK");

// 2. Lead status options (Test Lead sync enabled?)
const opts = await api("/campaigns/lead-status-options", { headers: bearer(token) });
const optBody = unwrapEnvelope(opts.data);
const leadOpts = optBody?.leadStatusOptions ?? optBody?.options ?? [];
const testOpt = (Array.isArray(leadOpts) ? leadOpts : []).filter((o) => {
  const v = String(o?.value ?? o?.label ?? "").toLowerCase();
  const s = String(o?.source ?? "").toLowerCase();
  return v.includes("test") || s === "test";
});
console.log("\n--- Lead status options (Test Lead) ---");
if (!opts.ok) {
  console.log("❌ GET lead-status-options failed:", opts.data?.message ?? opts.status);
} else if (testOpt.length === 0) {
  console.log("❌ Test Lead NOT in lead-status-options");
  console.log("   → Set ENABLE_TEST_LEAD_CATEGORY_SYNC=true on UAT server and restart UAT.");
} else {
  console.log("✅ Test Lead option present:", testOpt.map((o) => `${o.value} (source=${o.source})`).join(", "));
}

// 3. CRM_data count for Test Lead
const crm = await api(
  "/crm-data/get-crm-data?leadStatus=Test%20Lead&currentPage=1&pageSize=1",
  { headers: bearer(token) },
);
const crmBody = unwrapEnvelope(crm.data);
const pag = crmBody?.pagination ?? crm.data?.pagination;
const total = pag?.totalItems ?? pag?.totalRecords ?? null;
console.log("\n--- CRM_data (Test Lead tab source) ---");
if (!crm.ok || crm.data?.result === false) {
  console.log("❌ get-crm-data failed:", crm.data?.message ?? crm.status);
} else {
  console.log(`Current Test Lead count in CRM_data: ${total ?? "unknown"}`);
}

// 4. Sync preview
const preview = await api("/campaigns/sync-dynamics-categories/preview", { headers: bearer(token) });
const prevBody = unwrapEnvelope(preview.data);
const cats = prevBody?.categories ?? [];
const testCat = cats.find((c) => String(c.slug ?? "").includes("test"));
console.log("\n--- Dynamics sync PREVIEW (test_lead row) ---");
if (!preview.ok || preview.data?.result === false) {
  console.log("❌ Preview failed:", preview.data?.message ?? preview.status);
} else if (!testCat) {
  console.log("❌ No test_lead category in preview");
  console.log("   → ENABLE_TEST_LEAD_CATEGORY_SYNC=true missing on UAT, or FetchXML not registered.");
  console.log("   Categories in preview:", cats.map((c) => c.slug).join(", ") || "(none)");
} else {
  console.log("test_lead preview:", JSON.stringify(testCat, null, 2));
  if (testCat.dynamicsFetched === 0) {
    console.log("\n⚠️  Dynamics returned 0 test leads.");
    console.log("   Check Dynamics: new_currentstatus=181510001, active state, mobile phone set.");
  }
  if (testCat.skippedNoMobile > 0) {
    console.log(`\n⚠️  ${testCat.skippedNoMobile} lead(s) skipped — no mobile in Dynamics.`);
  }
  if (testCat.dynamicsFetched > 0 && testCat.insertedCount === 0 && testCat.updatedCount === 0) {
    console.log("\n⚠️  Fetched from Dynamics but preview shows 0 inserts/updates (dry run — run live Sync).");
  }
}

console.log("\n--- What to do ---");
console.log("1. Fix any ❌ above on your UAT server (port 3000).");
console.log("2. Data → Campaigns → Preview Sync → confirm test_lead dynamicsFetched > 0.");
console.log("3. Run live Sync from Dynamics (not Settings Lead Filter).");
console.log("4. Data → People → Test Lead → Refresh.");

const runLive = process.argv.includes("--live-sync");
const listAll = process.argv.includes("--list");
const findMissing = process.argv.includes("--find-missing");

if (findMissing) {
  const crmList = await api(
    "/crm-data/get-crm-data?leadStatus=Test%20Lead&currentPage=1&pageSize=100",
    { headers: bearer(token) },
  );
  const crmListBody = unwrapEnvelope(crmList.data);
  const rows = crmListBody?.data ?? crmList.data?.data ?? [];
  const crmArr = Array.isArray(rows) ? rows : [];
  const crmLeadIds = new Set(
    crmArr.map((r) => String(r.lead_id ?? r.leadId ?? "").toLowerCase()).filter(Boolean),
  );
  const crmPhones = new Set(
    crmArr
      .map((r) => String(r.mobile_number ?? r.mobileNumber ?? r.phone ?? "").replace(/\D/g, ""))
      .filter(Boolean),
  );

  console.log("\n--- CRM Test Lead IDs (in frontend) ---");
  for (const r of crmArr) {
    console.log(`  ${r.lead_id ?? r.leadId}  phone=${r.mobile_number ?? r.mobileNumber}`);
  }

  const prevFull = await api("/campaigns/sync-dynamics-categories/preview", { headers: bearer(token) });
  const prevFullBody = unwrapEnvelope(prevFull.data);
  const testPrev = (prevFullBody?.categories ?? []).find((c) => c.slug === "test_lead");

  // UAT may expose fetchedLeadIds / leadIds / sampleLeads on category or root
  const candidateKeys = [
    "fetchedLeadIds",
    "leadIds",
    "dynamicsLeadIds",
    "sampleLeads",
    "leads",
    "fetchedLeads",
  ];
  let dynamicsLeads = [];
  for (const key of candidateKeys) {
    if (Array.isArray(testPrev?.[key])) dynamicsLeads = testPrev[key];
    if (Array.isArray(prevFullBody?.[key])) dynamicsLeads = prevFullBody[key];
  }

  console.log("\n--- Dynamics vs CRM (test_lead) ---");
  console.log("CRM count:", crmLeadIds.size, "| Dynamics fetched:", testPrev?.dynamicsFetched ?? "?");

  if (dynamicsLeads.length > 0) {
    console.log("\nMissing from CRM (in Dynamics preview payload):");
    for (const item of dynamicsLeads) {
      const id = String(item?.lead_id ?? item?.leadId ?? item?.id ?? item ?? "").toLowerCase();
      const phone = String(item?.mobilephone ?? item?.mobile_number ?? item?.phone ?? "").replace(/\D/g, "");
      const inCrm = crmLeadIds.has(id);
      const phoneDup = phone && crmPhones.has(phone);
      if (!inCrm) {
        console.log(`  MISSING lead_id=${id} phone=${item?.mobilephone ?? item?.mobile_number ?? "?"} phoneDup=${phoneDup}`);
      }
    }
  } else {
    console.log("\n⚠️  UAT preview does not return individual Dynamics lead IDs.");
    console.log("   Compare manually in Dynamics: export 6 Test Lead GUIDs vs CRM list above.");
    console.log("   Known missing candidate from your webhook test: 17ce3e04-7486-f111-ab0f-7c1e5236cd73");
    console.log("   In CRM?", crmLeadIds.has("17ce3e04-7486-f111-ab0f-7c1e5236cd73") ? "yes" : "NO");

    // Search CRM broadly for common missing patterns
    const searches = ["17ce3e04", "7486-f111"];
    for (const q of searches) {
      const sr = await api(
        `/crm-data/get-crm-data?search=${encodeURIComponent(q)}&currentPage=1&pageSize=20`,
        { headers: bearer(token) },
      );
      const sb = unwrapEnvelope(sr.data);
      const srows = sb?.data ?? sr.data?.data ?? [];
      const sarr = Array.isArray(srows) ? srows : [];
      if (sarr.length) {
        console.log(`\nSearch "${q}" found ${sarr.length} CRM row(s):`);
        for (const r of sarr) {
          console.log(
            `  lead_id=${r.lead_id} lead_status=${r.lead_status} slug=${r.sync_category_slug} phone=${r.mobile_number}`,
          );
        }
      }
    }

    // Scan callback_request — UAT often moves test_lead rows here after sync
    console.log("\n--- callback_request tab (check for stolen Test Leads) ---");
    const cb = await api(
      "/crm-data/get-crm-data?sync_category_slug=callback_request&currentPage=1&pageSize=50",
      { headers: bearer(token) },
    );
    const cbBody = unwrapEnvelope(cb.data);
    const cbRows = cbBody?.data ?? cb.data?.data ?? [];
    const cbArr = Array.isArray(cbRows) ? cbRows : [];
    console.log("callback_request count:", cbBody?.pagination?.totalItems ?? cbArr.length);
    const stolenIds = [
      "a7f7cc0f-9c8d-f111-ab10-7ced8d460595",
      "d4ffa937-998d-f111-ab10-7ced8d460595",
    ];
    for (const r of cbArr) {
      const id = String(r.lead_id ?? r.leadId ?? "");
      const marker = stolenIds.some((s) => id.toLowerCase().startsWith(s.slice(0, 8))) ? " ← likely stolen from test_lead" : "";
      console.log(`  lead_id=${id} phone=${r.mobile_number ?? r.mobileNumber} status=${r.lead_status}${marker}`);
    }
    for (const sid of stolenIds) {
      const inCb = cbArr.some((r) => String(r.lead_id ?? "").toLowerCase() === sid.toLowerCase());
      const inTest = crmLeadIds.has(sid.toLowerCase());
      console.log(`\n${sid}: Test Lead tab=${inTest ? "YES" : "NO"} | Callback Request=${inCb ? "YES" : "NO"}`);
    }

    // Scan other cohort slugs for missing Dynamics IDs (may exist outside test_lead tab)
    const otherSlugs = ["disqualified", "tried_to_contact", "rebook_initial_consultation"];
    console.log("\n--- Rows with lead_status=Test Lead outside test_lead tab ---");
    for (const slug of otherSlugs) {
      const or = await api(
        `/crm-data/get-crm-data?sync_category_slug=${slug}&currentPage=1&pageSize=200`,
        { headers: bearer(token) },
      );
      const ob = unwrapEnvelope(or.data);
      const orows = ob?.data ?? or.data?.data ?? [];
      const oarr = Array.isArray(orows) ? orows : [];
      for (const r of oarr) {
        const ls = String(r.lead_status ?? r.leadStatus ?? "");
        const id = String(r.lead_id ?? r.leadId ?? "");
        if (/test lead/i.test(ls) || id.startsWith("17ce3e04")) {
          console.log(
            `  slug=${slug} lead_id=${id} lead_status=${ls} phone=${r.mobile_number ?? r.mobileNumber}`,
          );
        }
      }
    }

    // Also: Test Lead status query without slug (any category)
    const anyTest = await api(
      "/crm-data/get-crm-data?leadStatus=Test%20Lead&currentPage=1&pageSize=100",
      { headers: bearer(token) },
    );
    const anyBody = unwrapEnvelope(anyTest.data);
    const anyRows = anyBody?.data ?? anyTest.data?.data ?? [];
    const anyArr = Array.isArray(anyRows) ? anyRows : [];
    const inTab = new Set(anyArr.map((r) => String(r.lead_id ?? "").toLowerCase()));
    console.log("\n--- Summary ---");
    console.log(`Test Lead status in CRM (all slugs): ${anyArr.length} rows`);
    console.log(`Test Lead tab (leadStatus filter): ${crmLeadIds.size} rows`);
    if (anyArr.length > crmLeadIds.size) {
      console.log("(Counts match — missing leads are NOT in CRM with Test Lead status at all)");
    }

    if (prevFullBody?.duplicateLeadIds?.length) {
      console.log("\nduplicateLeadIds:", JSON.stringify(prevFullBody.duplicateLeadIds, null, 2));
    }
  }

  console.log("\n--- Likely reasons 2 Dynamics leads don't appear ---");
  console.log("1. Same phone as an existing Test Lead row (UAT dedupes by phone).");
  console.log("2. lead_id exists in CRM under another category (DQ/TTC) — not moved to test_lead.");
  console.log("3. UAT sync bug when ENABLE_TEST_LEAD_CATEGORY_SYNC is off (lead-status-options missing).");
  console.log("4. Fix on UAT server: enable flag, ensure upsert sets sync_category_slug=test_lead + lead_status=Test Lead.");
  process.exit(0);
}

if (listAll || runLive) {
  const crmList = await api(
    "/crm-data/get-crm-data?leadStatus=Test%20Lead&currentPage=1&pageSize=50",
    { headers: bearer(token) },
  );
  const crmListBody = unwrapEnvelope(crmList.data);
  const rows = crmListBody?.data ?? crmList.data?.data ?? [];
  const arr = Array.isArray(rows) ? rows : [];
  console.log("\n--- CRM_data rows (leadStatus=Test Lead) ---");
  console.log("count:", arr.length, "pagination:", JSON.stringify(crmListBody?.pagination ?? crmList.data?.pagination));
  for (const r of arr) {
    console.log(
      `- lead_id=${r.lead_id ?? r.leadId} phone=${r.mobile_number ?? r.mobileNumber} lead_status=${r.lead_status ?? r.leadStatus} slug=${r.sync_category_slug ?? r.syncCategorySlug}`,
    );
  }

  const crmSlug = await api(
    "/crm-data/get-crm-data?sync_category_slug=test_lead&currentPage=1&pageSize=50",
    { headers: bearer(token) },
  );
  const slugBody = unwrapEnvelope(crmSlug.data);
  const slugRows = slugBody?.data ?? crmSlug.data?.data ?? [];
  const slugArr = Array.isArray(slugRows) ? slugRows : [];
  console.log("\n--- CRM_data rows (sync_category_slug=test_lead) ---");
  console.log("count:", slugArr.length, "pagination:", JSON.stringify(slugBody?.pagination ?? crmSlug.data?.pagination));
}

if (runLive) {
  console.log("\n--- LIVE SYNC (writing to CRM_data) ---");
  const sync = await api("/campaigns/sync-dynamics-categories", {
    method: "POST",
    headers: bearer(token),
    body: JSON.stringify({ scheduleCampaign: false }),
  });
  const syncBody = unwrapEnvelope(sync.data);
  if (!sync.ok || sync.data?.result === false) {
    console.log("❌ Live sync failed:", sync.data?.message ?? sync.error ?? sync.status);
  } else {
    const testAfter = (syncBody?.categories ?? []).find((c) => String(c.slug ?? "").includes("test"));
    console.log("Live sync test_lead:", JSON.stringify(testAfter, null, 2));
    if (syncBody?.duplicateLeadIds?.length) {
      console.log("duplicateLeadIds:", JSON.stringify(syncBody.duplicateLeadIds, null, 2));
    }
    const crm2 = await api(
      "/crm-data/get-crm-data?leadStatus=Test%20Lead&currentPage=1&pageSize=1",
      { headers: bearer(token) },
    );
    const pag2 = unwrapEnvelope(crm2.data)?.pagination ?? crm2.data?.pagination;
    console.log("CRM_data Test Lead count after live sync:", pag2?.totalItems ?? pag2?.totalRecords ?? "?");
  }
}
