/**
 * WBAH Categorized Lead Sync Engine
 *
 * Pulls leads from WeeBespoke API, classifies them into three WEBEE categories:
 *   - disqualified
 *   - tried_to_contact
 *   - rebooking
 *
 * Uses /leadfiltermaster/get-leadfiltermaster and /lead-filterStatus/get-statusCode
 * to build a dynamic status-code → category map, then fetches all leads and
 * upserts them into wbah_categorized_leads.
 *
 * Safe to import from vite.config.ts (no @/ aliases, only relative imports).
 */

import { createClient } from "@supabase/supabase-js";

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL        = "https://uat-api.webespokeai.com";
const INTEGRATION_KEY = "webespoke_enterprise";
const CLIENT_NAME     = "Webuyanyhouse";
const WBAH_SLUG       = "webuyanyhouse";

export type WbeeCategory = "disqualified" | "tried_to_contact" | "rebooking";

// ── Category alias patterns ───────────────────────────────────────────────────

const CATEGORY_PATTERNS: Record<WbeeCategory, RegExp> = {
  disqualified:    /disqualif|disqual|not[_\s]interested|rejected|unsuitable|do[_\s]?not[_\s]?call|\bDQ\b/i,
  tried_to_contact: /tried[_\s]?to[_\s]?contact|no[_\s]answer|not[_\s]connect|voicemail|not[_\s]contact|no[_\s]contact|\bTTC\b|not\s+reached/i,
  rebooking:       /rebooking|rebook|call[_\s]?back|call[_\s]?later|pending[_\s]?callback|rebooked|\bCB\b|call\s+later|appointment/i,
};

function labelToCategory(label: string): WbeeCategory | null {
  const l = (label ?? "").trim();
  for (const [cat, rx] of Object.entries(CATEGORY_PATTERNS) as [WbeeCategory, RegExp][]) {
    if (rx.test(l)) return cat;
  }
  return null;
}

// ── Supabase admin ─────────────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ── Low-level fetch ────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, token: string): Promise<{ ok: boolean; data: T | null; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });
    if (res.status === 204) return { ok: true, data: null };
    const text = await res.text();
    let data: T | null = null;
    try { data = JSON.parse(text) as T; } catch { /**/ }
    return { ok: res.ok, data, error: res.ok ? undefined : text.slice(0, 300) };
  } catch (err: any) {
    return { ok: false, data: null, error: err?.message ?? "Network error" };
  }
}

// ── Token management ──────────────────────────────────────────────────────────

async function getStoredToken(sb: ReturnType<typeof getAdminClient>): Promise<string | null> {
  const { data } = await (sb as any).from("enterprise_integrations")
    .select("access_token, status")
    .eq("integration_key", INTEGRATION_KEY)
    .eq("client_name", CLIENT_NAME)
    .maybeSingle();
  if (!data || data.status !== "connected" || !data.access_token) return null;
  return data.access_token as string;
}

async function ensureFreshToken(sb: ReturnType<typeof getAdminClient>): Promise<string> {
  const email    = process.env.WEBESPOKE_ADMIN_EMAIL;
  const password = process.env.WEBESPOKE_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Set WEBESPOKE_ADMIN_EMAIL + WEBESPOKE_ADMIN_PASSWORD in Replit Secrets.");

  const res = await fetch(`${BASE_URL}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const d = await res.json() as any;
  const token =
    d.accessToken ?? d.token ?? d.access_token ??
    d.data?.accessToken ?? d.data?.token ?? d.data?.access_token ?? null;
  if (!token) throw new Error("Re-login succeeded but no token in response");

  await (sb as any).from("enterprise_integrations").upsert(
    { integration_key: INTEGRATION_KEY, client_name: CLIENT_NAME, access_token: token, status: "connected" },
    { onConflict: "integration_key,client_name" },
  );
  return token;
}

// ── Extract array from any API response shape ──────────────────────────────────

function extractArr(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  for (const key of ["data", "records", "leads", "result", "items", "list", "statuses", "filters"]) {
    if (Array.isArray((raw as any)[key])) return (raw as any)[key];
  }
  for (const v of Object.values(raw as object)) {
    if (Array.isArray(v) && (v as any[]).length > 0) return v as any[];
  }
  return [];
}

// ── Build status-code → category map ─────────────────────────────────────────

export type CategoryStatusMap = Record<WbeeCategory, string[]>;

export async function buildCategoryStatusMap(token: string): Promise<{
  map: CategoryStatusMap;
  rawMaster: any[];
  rawCodes: any[];
}> {
  const map: CategoryStatusMap = { disqualified: [], tried_to_contact: [], rebooking: [] };

  // Fetch lead filter master
  const masterRes = await apiFetch<any>("/leadfiltermaster/get-leadfiltermaster", token);
  const masterItems = masterRes.ok ? extractArr(masterRes.data) : [];

  // Fetch status codes
  const codesRes = await apiFetch<any>("/lead-filterStatus/get-statusCode", token);
  const codeItems = codesRes.ok ? extractArr(codesRes.data) : [];

  // Map by label — check master filter names first
  for (const item of masterItems) {
    const label = String(item?.filterName ?? item?.name ?? item?.label ?? item?.title ?? "");
    const code  = String(item?._id ?? item?.id ?? item?.filterCode ?? item?.statusCode ?? item?.code ?? label);
    if (!label) continue;
    const cat = labelToCategory(label);
    if (cat && !map[cat].includes(code)) map[cat].push(code);
    // Also add any nested statusCode / code fields
    const inner = String(item?.statusCode ?? item?.code ?? "");
    if (inner && cat && !map[cat].includes(inner)) map[cat].push(inner);
  }

  // Also map individual status codes
  for (const item of codeItems) {
    const label = String(item?.statusName ?? item?.name ?? item?.label ?? item?.title ?? "");
    const code  = String(item?.statusCode ?? item?.code ?? item?._id ?? item?.id ?? label);
    if (!label) continue;
    const cat = labelToCategory(label);
    if (cat && !map[cat].includes(code)) map[cat].push(code);
  }

  // If no codes found for a category, fall back to the pattern-matched category name itself
  // so we can at least classify by the lead's status text
  for (const cat of Object.keys(map) as WbeeCategory[]) {
    if (map[cat].length === 0) {
      // Push sentinel values so classifyLead knows to use text-matching fallback
      map[cat].push("__pattern_only__");
    }
  }

  console.log(`[wbah-category-sync] status map: disqualified=${map.disqualified.length} ttc=${map.tried_to_contact.length} rebooking=${map.rebooking.length}`);
  return { map, rawMaster: masterItems, rawCodes: codeItems };
}

// ── Classify a single lead record ─────────────────────────────────────────────
// Uses the same logic as classifyStatus() in wbah-leads-sync-tick.ts, then
// additionally checks the filter master UUID map for any custom status codes.

function pickStr(raw: any, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = raw?.[k];
    if (v != null && String(v).trim() && String(v) !== "null" && String(v) !== "undefined") return String(v).trim();
  }
  return null;
}

function statusHaystack(raw: any): string {
  return [
    raw?.status, raw?.leadStatus, raw?.crmStatus, raw?.callStatus,
    raw?.qualificationStatus, raw?.sentiment, raw?.sentimentAnalysis,
    raw?.disconnectionReason, raw?.lead_status, raw?.filterStatus,
    raw?.callOutcome, raw?.leadFilterStatus, raw?.filterName,
  ].filter(Boolean).join(" ").toLowerCase();
}

function classifyLead(raw: any, map: CategoryStatusMap): WbeeCategory | null {
  const cs  = (raw?.callStatus       ?? "").toLowerCase();
  const sa  = (raw?.sentimentAnalysis ?? raw?.sentiment ?? "").toLowerCase();
  const dr  = (raw?.disconnectionReason ?? "").toLowerCase();
  const bs  = (raw?.booking_status   ?? raw?.bookingStatus ?? "").toLowerCase();
  const ntc = raw?.need_to_call;
  const neg = raw?.is_negative_sentiment;

  // ── Rebooking: explicit booking_status or appointment fields ──────────────
  if (/rebooking|rebook|rescheduled|call[_\s]?back|call[_\s]?later|pending[_\s]?call|callback/.test(bs)) return "rebooking";
  if (cs === "rebooking" || cs === "call_back" || cs === "callback") return "rebooking";
  if (/rebooking|rebook|rescheduled|call[_\s]?back|call[_\s]?later|pending[_\s]?call|callback/.test(cs)) return "rebooking";
  // Appointment + not_connected = likely rebooking
  if ((raw?.appointment_date || raw?.appointmentDate) && (cs === "not_connected" || cs === "no_answer" || cs === "voicemail")) return "rebooking";

  // ── Tried To Contact: no_answer / voicemail / not_connected ───────────────
  if (ntc === false && !neg && (cs === "not_connected" || cs === "no_answer" || cs === "voicemail")) return "tried_to_contact";
  if (/voicemail|no_answer|no_input|dial_no_answer|not_connected/.test(dr)) return "tried_to_contact";
  if (cs === "not_connected" || cs === "no_answer" || cs === "voicemail") return "tried_to_contact";

  // ── Disqualified: negative sentiment / explicit disqualification ──────────
  if (neg === true) return "disqualified";
  if (cs === "ended" || cs === "call_analyzed") {
    if (/negative/.test(sa)) return "disqualified";
    // ended + voicemail disconnection = tried_to_contact
    if (/voicemail|no_answer|no_input|dial_no_answer/.test(dr)) return "tried_to_contact";
  }

  // ── Pattern matching on full haystack ─────────────────────────────────────
  const h = statusHaystack(raw);
  if (/disqualif|not[_\s]?interested|reject|unsuitable|do[_\s]?not[_\s]?call/.test(h)) return "disqualified";
  if (/tried[_\s]?to[_\s]?contact|no[_\s]?answer|voicemail|not[_\s]?connect/.test(h)) return "tried_to_contact";
  if (/rebooking|rebook|call[_\s]?back|call[_\s]?later|callback/.test(h)) return "rebooking";

  // ── Filter master UUID / code lookup (custom status codes set in WeeBespoke dashboard) ──
  const codeFields = [
    raw?.leadFilterMasterId, raw?.filterMasterId, raw?.lead_filter_master_id,
    raw?.filterCode, raw?.filterStatus, raw?.leadFilterStatus,
    raw?.lead_status, raw?.crmStatus,
  ].filter(Boolean).map(String);

  for (const val of codeFields) {
    const v = val.trim();
    for (const [cat, codes] of Object.entries(map) as [WbeeCategory, string[]][]) {
      if (codes.includes("__pattern_only__")) continue;
      if (codes.some(c => c === v || c.toLowerCase() === v.toLowerCase())) return cat as WbeeCategory;
    }
  }

  return null;
}

// ── Debug first-N leads (called once) ────────────────────────────────────────
let _debugLogged = false;
function debugLeadSample(leads: any[]): void {
  if (_debugLogged || leads.length === 0) return;
  _debugLogged = true;
  const sample = leads[0];
  console.log("[wbah-category-sync] SAMPLE lead status fields:", JSON.stringify({
    callStatus:          sample?.callStatus,
    sentimentAnalysis:   sample?.sentimentAnalysis,
    disconnectionReason: sample?.disconnectionReason,
    lead_status:         sample?.lead_status,
    status:              sample?.status,
    booking_status:      sample?.booking_status,
    bookingStatus:       sample?.bookingStatus,
    is_negative_sentiment: sample?.is_negative_sentiment,
    need_to_call:        sample?.need_to_call,
    leadFilterMasterId:  sample?.leadFilterMasterId,
    filterCode:          sample?.filterCode,
    appointment_date:    sample?.appointment_date,
  }));
  // Count distributions
  const byStatus: Record<string, number> = {};
  const bySentiment: Record<string, number> = {};
  const byDR: Record<string, number> = {};
  for (const l of leads) {
    const cs = String(l?.callStatus ?? "unknown");
    byStatus[cs] = (byStatus[cs] ?? 0) + 1;
    const sa = String(l?.sentimentAnalysis ?? "unknown");
    bySentiment[sa] = (bySentiment[sa] ?? 0) + 1;
    const dr = String(l?.disconnectionReason ?? "unknown");
    byDR[dr] = (byDR[dr] ?? 0) + 1;
  }
  console.log("[wbah-category-sync] callStatus distribution:", JSON.stringify(byStatus));
  console.log("[wbah-category-sync] sentimentAnalysis distribution:", JSON.stringify(bySentiment));
  console.log("[wbah-category-sync] disconnectionReason distribution (top 5):", JSON.stringify(
    Object.fromEntries(Object.entries(byDR).sort((a,b) => b[1]-a[1]).slice(0,5))
  ));
  // Log ALL keys from first lead to help map field names
  console.log("[wbah-category-sync] lead field keys:", JSON.stringify(Object.keys(sample).slice(0, 30)));
}

// ── Build a categorized lead row ───────────────────────────────────────────────

function buildCatLeadRow(raw: any, workspaceId: string, category: WbeeCategory): {
  workspace_id: string;
  external_lead_id: string;
  external_source: string;
  external_status_code: string | null;
  external_status_label: string | null;
  webee_category: WbeeCategory;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  postcode: string | null;
  property_type: string | null;
  meta: Record<string, unknown>;
  last_synced_at: string;
} {
  const crm = raw?.crmData ?? {};
  const externalId = pickStr(raw, "lead_id", "_id", "id", "leadId", "sellerId", "unique_id") ?? "";
  const statusCode  = pickStr(raw, "lead_status", "leadStatus", "status", "callStatus", "filterStatus", "filterCode") ?? null;
  const statusLabel = pickStr(raw, "filterName", "statusLabel", "statusName", "callStatus") ?? null;

  const fullName = pickStr(raw, "name", "fullName", "leadName", "customerName") ?? pickStr(crm, "name", "firstname") ?? "Unknown";
  const firstName = pickStr(raw, "firstName", "first_name") ?? pickStr(crm, "firstname", "firstName");
  const lastName  = pickStr(raw, "lastName", "last_name") ?? pickStr(crm, "lastname", "lastName");

  return {
    workspace_id:          workspaceId,
    external_lead_id:      externalId,
    external_source:       "webuyanyhouse_dashboard",
    external_status_code:  statusCode,
    external_status_label: statusLabel,
    webee_category:        category,
    full_name:             fullName,
    first_name:            firstName,
    last_name:             lastName,
    phone:                 pickStr(raw, "toNumber", "fromNumber", "phone", "phoneNumber", "mobile") ?? pickStr(crm, "mobile_number", "mobileNumber"),
    email:                 pickStr(raw, "email", "emailAddress") ?? pickStr(crm, "email"),
    address:               pickStr(crm, "new_propinfo_street2", "address1_line1") ?? pickStr(raw, "address", "propertyAddress"),
    city:                  pickStr(crm, "new_propinfo_city", "address1_city") ?? pickStr(raw, "city"),
    postcode:              pickStr(crm, "new_propinfo_postalcode", "address1_postalcode") ?? pickStr(raw, "postcode", "postCode"),
    property_type:         pickStr(crm, "property_type") ?? pickStr(raw, "propertyType"),
    meta: {
      raw_status_code:     statusCode,
      raw_lead:            raw,
      wbah_synced_at:      new Date().toISOString(),
      call_id:             pickStr(raw, "callId", "call_id"),
      recording_url:       pickStr(raw, "recordingUrl", "recording_url"),
      appointment_date:    pickStr(raw, "appointment_date", "callAppointmentDate"),
      booking_status:      pickStr(raw, "booking_status", "bookingStatus"),
      expected_price:      pickStr(raw, "askingPrice", "expectedPrice"),
    },
    last_synced_at: new Date().toISOString(),
  };
}

// ── Paginated lead fetch ──────────────────────────────────────────────────────

async function fetchAllLeads(token: string): Promise<any[]> {
  const p1 = await apiFetch<any>(`/call-output-data/get-userCall-lead?currentPage=1`, token);
  if (!p1.ok || !p1.data) return [];

  const p1Recs: any[] = Array.isArray(p1.data?.data) ? p1.data.data : Array.isArray(p1.data) ? p1.data : [];
  const pagination    = p1.data?.pagination ?? {};
  const totalItems    = pagination?.totalItems ?? 0;
  const pageSize      = p1Recs.length || 50;
  const totalPages    = totalItems > 0 ? Math.ceil(totalItems / pageSize) : (pagination?.totalPages ?? 1);

  const makeId = (r: any) => String(r?.lead_id ?? r?._id ?? r?.id ?? r?.leadId ?? "").trim();
  const seenIds = new Set<string>(p1Recs.map(makeId).filter(Boolean));
  const all: any[] = [...p1Recs];

  console.log(`[wbah-category-sync] fetchAllLeads: totalItems=${totalItems} pageSize=${pageSize} totalPages=${totalPages}`);

  for (let page = 2; page <= totalPages; page += 5) {
    const batch = Array.from({ length: Math.min(5, totalPages - page + 1) }, (_, i) => page + i);
    const results = await Promise.allSettled(
      batch.map(p => apiFetch<any>(`/call-output-data/get-userCall-lead?currentPage=${p}`, token))
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.ok && r.value.data) {
        const recs = Array.isArray(r.value.data?.data) ? r.value.data.data : Array.isArray(r.value.data) ? r.value.data : [];
        for (const rec of recs) {
          const id = makeId(rec);
          if (id && seenIds.has(id)) continue;
          if (id) seenIds.add(id);
          all.push(rec);
        }
      }
    }
    if (page + 5 <= totalPages) await new Promise(res => setTimeout(res, 150));
  }

  console.log(`[wbah-category-sync] fetchAllLeads done: ${all.length} records`);
  return all;
}

// ── Upsert rows ───────────────────────────────────────────────────────────────

async function upsertCategorizedLeads(
  sb: ReturnType<typeof getAdminClient>,
  rows: ReturnType<typeof buildCatLeadRow>[],
  workspaceId: string,
): Promise<{ imported: number; updated: number; skipped: number; failed: number }> {
  if (!rows.length) return { imported: 0, updated: 0, skipped: 0, failed: 0 };

  const ids = rows.map(r => r.external_lead_id).filter(Boolean);
  const { data: existing } = await (sb as any).from("wbah_categorized_leads")
    .select("id, external_lead_id")
    .eq("workspace_id", workspaceId)
    .in("external_lead_id", ids);

  const existingMap = new Map<string, string>((existing ?? []).map((r: any) => [r.external_lead_id, r.id]));

  const toInsert: typeof rows = [];
  const toUpdate: typeof rows = [];
  const skipped: typeof rows = [];

  for (const row of rows) {
    if (!row.external_lead_id) { skipped.push(row); continue; }
    if (existingMap.has(row.external_lead_id)) toUpdate.push(row);
    else toInsert.push(row);
  }

  let imported = 0, updated = 0, failed = 0;

  // Insert new records in batches
  const BATCH = 200;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const { error } = await (sb as any).from("wbah_categorized_leads").insert(toInsert.slice(i, i + BATCH));
    if (error) {
      console.error(`[wbah-category-sync] insert error:`, error.message);
      failed += toInsert.slice(i, i + BATCH).length;
    } else {
      imported += toInsert.slice(i, i + BATCH).length;
    }
  }

  // Update existing records in batches
  for (let i = 0; i < toUpdate.length; i += BATCH) {
    const batch = toUpdate.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(row => {
        const id = existingMap.get(row.external_lead_id)!;
        const { external_lead_id: _eid, workspace_id: _wid, ...updateData } = row;
        return (sb as any).from("wbah_categorized_leads").update(updateData).eq("id", id);
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled" && !r.value.error) updated++;
      else failed++;
    }
  }

  return { imported, updated, skipped: skipped.length, failed };
}

// ── Write sync log ─────────────────────────────────────────────────────────────

async function writeSyncLog(
  sb: ReturnType<typeof getAdminClient>,
  workspaceId: string,
  category: WbeeCategory,
  stats: { imported: number; updated: number; skipped: number; failed: number; total_records: number; duration_ms: number },
  options: { externalStatusCodes?: string[]; endpointUsed?: string; errorMessage?: string } = {},
) {
  await (sb as any).from("wbah_category_sync_log").insert({
    workspace_id:          workspaceId,
    category,
    imported:              stats.imported,
    updated:               stats.updated,
    skipped:               stats.skipped,
    failed:                stats.failed,
    total_records:         stats.total_records,
    duration_ms:           stats.duration_ms,
    external_status_codes: options.externalStatusCodes ?? [],
    endpoint_used:         options.endpointUsed ?? "/call-output-data/get-userCall-lead",
    error_message:         options.errorMessage ?? null,
  });
}

// ── Main exported sync function ────────────────────────────────────────────────

export interface WbahCategorySyncResult {
  disqualified:    { imported: number; updated: number; skipped: number; failed: number; total: number };
  tried_to_contact: { imported: number; updated: number; skipped: number; failed: number; total: number };
  rebooking:       { imported: number; updated: number; skipped: number; failed: number; total: number };
  total_leads_fetched: number;
  errors: string[];
  duration_ms: number;
}

export async function runWbahCategorySyncTick(opts?: {
  categoriesOnly?: WbeeCategory[];
}): Promise<WbahCategorySyncResult> {
  const startTime = Date.now();
  const sb = getAdminClient();
  const errors: string[] = [];

  const result: WbahCategorySyncResult = {
    disqualified:     { imported: 0, updated: 0, skipped: 0, failed: 0, total: 0 },
    tried_to_contact: { imported: 0, updated: 0, skipped: 0, failed: 0, total: 0 },
    rebooking:        { imported: 0, updated: 0, skipped: 0, failed: 0, total: 0 },
    total_leads_fetched: 0,
    errors,
    duration_ms: 0,
  };

  // Get workspace
  const { data: ws } = await (sb as any).from("workspaces").select("id").eq("slug", WBAH_SLUG).maybeSingle();
  if (!ws?.id) { errors.push("Webuyanyhouse workspace not found"); result.duration_ms = Date.now() - startTime; return result; }
  const workspaceId: string = ws.id;

  // Get fresh token
  let token: string;
  try {
    token = await ensureFreshToken(sb);
  } catch (e: any) {
    // Try stored token first
    const stored = await getStoredToken(sb);
    if (!stored) { errors.push(`Auth failed: ${e?.message}`); result.duration_ms = Date.now() - startTime; return result; }
    token = stored;
  }

  // Build category → status code map
  let statusMap: CategoryStatusMap;
  try {
    const { map } = await buildCategoryStatusMap(token);
    statusMap = map;
  } catch (e: any) {
    errors.push(`Status map build failed: ${e?.message}`);
    // Fall back to pattern-only matching
    statusMap = {
      disqualified:     ["__pattern_only__"],
      tried_to_contact: ["__pattern_only__"],
      rebooking:        ["__pattern_only__"],
    };
  }

  // Fetch all leads
  let allLeads: any[];
  try {
    allLeads = await fetchAllLeads(token);
    result.total_leads_fetched = allLeads.length;
    debugLeadSample(allLeads);
  } catch (e: any) {
    errors.push(`Lead fetch failed: ${e?.message}`);
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  // Categorize leads
  const buckets: Record<WbeeCategory, any[]> = {
    disqualified:     [],
    tried_to_contact: [],
    rebooking:        [],
  };

  for (const lead of allLeads) {
    const cat = classifyLead(lead, statusMap);
    if (cat) buckets[cat].push(lead);
  }

  const categoriesToSync = (opts?.categoriesOnly ?? (["disqualified", "tried_to_contact", "rebooking"] as WbeeCategory[]));

  // Upsert each category
  for (const cat of categoriesToSync) {
    const leads = buckets[cat];
    const catStart = Date.now();
    console.log(`[wbah-category-sync] syncing category=${cat} leads=${leads.length} statusCodes=${statusMap[cat].filter(c => c !== "__pattern_only__").join(",") || "pattern-only"}`);

    if (leads.length === 0) {
      await writeSyncLog(sb, workspaceId, cat, { imported: 0, updated: 0, skipped: 0, failed: 0, total_records: 0, duration_ms: Date.now() - catStart }, {
        externalStatusCodes: statusMap[cat].filter(c => c !== "__pattern_only__"),
      });
      continue;
    }

    const rows = leads.map(r => buildCatLeadRow(r, workspaceId, cat));
    let stats: { imported: number; updated: number; skipped: number; failed: number };
    try {
      stats = await upsertCategorizedLeads(sb, rows, workspaceId);
    } catch (e: any) {
      errors.push(`${cat} upsert failed: ${e?.message}`);
      stats = { imported: 0, updated: 0, skipped: leads.length, failed: 0 };
    }

    result[cat] = { ...stats, total: leads.length };

    await writeSyncLog(sb, workspaceId, cat, { ...stats, total_records: leads.length, duration_ms: Date.now() - catStart }, {
      externalStatusCodes: statusMap[cat].filter(c => c !== "__pattern_only__"),
    });

    console.log(`[wbah-category-sync] ${cat}: imported=${stats.imported} updated=${stats.updated} skipped=${stats.skipped} failed=${stats.failed}`);
  }

  result.duration_ms = Date.now() - startTime;
  console.log(`[wbah-category-sync] done in ${result.duration_ms}ms: dq=${result.disqualified.imported+result.disqualified.updated} ttc=${result.tried_to_contact.imported+result.tried_to_contact.updated} rb=${result.rebooking.imported+result.rebooking.updated}`);
  return result;
}
