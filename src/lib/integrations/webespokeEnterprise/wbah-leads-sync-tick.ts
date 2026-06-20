/**
 * WBAH Leads Sync Tick — self-contained, no @/ aliases.
 *
 * Safe to import from vite.config.ts at config-load time (same pattern as
 * ads-sync-tick.ts). Uses createClient directly and relative paths only.
 *
 * Called by:
 *  - wbah-leads-sync.plugin.ts  (dev: every 30 min via Vite plugin)
 */
import { createClient } from "@supabase/supabase-js";

// ── Supabase admin client ─────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ── WeeBespoke API constants ──────────────────────────────────────────────────

const BASE_URL        = "https://uat-api.webespokeai.com";
const INTEGRATION_KEY = "webespoke_enterprise";
const CLIENT_NAME     = "Webuyanyhouse";
const WBAH_SLUG       = "webuyanyhouse";
const SOURCE_DETAIL   = "webespoke_enterprise";

// ── Low-level fetch helpers ───────────────────────────────────────────────────

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    });
    if (res.status === 204) return { ok: true, status: 204, data: null };
    const text = await res.text();
    let data: T | null = null;
    try { data = JSON.parse(text) as T; } catch { /**/ }
    return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : text.slice(0, 300) };
  } catch (err: any) {
    return { ok: false, status: 0, data: null, error: err?.message ?? "Network error" };
  }
}

async function loginWithPassword(email: string, password: string) {
  return apiFetch<any>("/admin/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

// ── Token management ─────────────────────────────────────────────────────────

async function getStoredTokens(sb: ReturnType<typeof getAdminClient>): Promise<{ accessToken: string; refreshToken: string } | null> {
  const { data } = await (sb as any).from("enterprise_integrations")
    .select("access_token, refresh_token, status")
    .eq("integration_key", INTEGRATION_KEY)
    .eq("client_name", CLIENT_NAME)
    .maybeSingle();
  if (!data || data.status !== "connected" || !data.access_token) return null;
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? "" };
}

async function saveToken(sb: ReturnType<typeof getAdminClient>, token: string): Promise<void> {
  await (sb as any).from("enterprise_integrations")
    .update({ access_token: token, status: "connected" })
    .eq("integration_key", INTEGRATION_KEY)
    .eq("client_name", CLIENT_NAME);
}

async function ensureFreshToken(sb: ReturnType<typeof getAdminClient>): Promise<void> {
  const email    = process.env.WEBESPOKE_ADMIN_EMAIL;
  const password = process.env.WEBESPOKE_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Set WEBESPOKE_ADMIN_EMAIL + WEBESPOKE_ADMIN_PASSWORD in Replit Secrets.");

  const res = await loginWithPassword(email, password);
  if (!res.ok || !res.data) throw new Error(`WeeBespoke re-login failed (HTTP ${res.status}): ${res.error ?? "no body"}`);

  const d = res.data as any;
  const accessToken =
    d.accessToken ?? d.token ?? d.access_token ??
    d.data?.accessToken ?? d.data?.token ?? d.data?.access_token ?? null;
  const refreshToken =
    d.refreshToken ?? d.refresh_token ?? d.data?.refreshToken ?? d.data?.refresh_token ?? "";
  if (!accessToken) throw new Error("Re-login succeeded but no token in response");

  await (sb as any).from("enterprise_integrations").upsert(
    { integration_key: INTEGRATION_KEY, client_name: CLIENT_NAME, access_token: accessToken, refresh_token: refreshToken, status: "connected" },
    { onConflict: "integration_key,client_name" },
  );
}

// ── Data classification helpers ───────────────────────────────────────────────

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
    raw?.qualificationStatus, raw?.sentiment, raw?.sentimentAnalysis, raw?.disconnectionReason,
  ].filter(Boolean).join(" ").toLowerCase();
}

function classifyStatus(raw: any): string {
  const cs = (raw?.callStatus ?? "").toLowerCase();
  const sa = (raw?.sentimentAnalysis ?? "").toLowerCase();
  if (raw?.need_to_call === true) return "need_to_call";
  if (raw?.is_negative_sentiment === true) return "not_interested";
  if (cs === "need_to_call") return "need_to_call";
  if (cs === "ended" || cs === "call_analyzed") {
    if (/negative/.test(sa)) return "not_interested";
    if (/positive|neutral/.test(sa)) return "qualified";
    const dr = (raw?.disconnectionReason ?? "").toLowerCase();
    if (/voicemail|no_answer|no_input|dial_no_answer/.test(dr)) return "not_connected";
    return "qualified";
  }
  if (cs === "not_connected" || cs === "no_answer" || cs === "voicemail") return "not_connected";
  const h = statusHaystack(raw);
  if (/disqualif|reject|unsuitable|do[_\s]?not[_\s]?call/.test(h)) return "not_interested";
  if (/tried.{0,10}contact|no[_\s]answer|voicemail/.test(h)) return "not_connected";
  if (/qualified|positive|neutral/.test(h)) return "qualified";
  return "need_to_call";
}

function classifySentiment(raw: any): string | null {
  const sa = (raw?.sentimentAnalysis ?? raw?.sentiment ?? "").toLowerCase();
  if (/positive|interested|keen|motivated/.test(sa)) return "positive";
  if (/neutral|maybe|unsure|undecided/.test(sa)) return "neutral";
  if (/negative|disqualif|not[_\s]interested|hostile/.test(sa)) return "negative";
  return null;
}

function classifyPipelineStage(status: string): string {
  if (status === "not_interested") return "lost";
  if (status === "not_connected")  return "discovery";
  if (status === "qualified")      return "proposal";
  return "new_lead";
}

function classifyQualificationStatus(raw: any): string | null {
  const h = statusHaystack(raw);
  if (/qualified|positive|neutral/.test(h)) return "qualified";
  if (/disqualif|reject|unsuitable/.test(h)) return "not_qualified";
  return null;
}

// ── Row builders ─────────────────────────────────────────────────────────────

function buildLeadRow(raw: any, workspaceId: string) {
  const status     = classifyStatus(raw);
  const crm        = raw?.crmData ?? {};
  const externalId = pickStr(raw, "lead_id", "id", "_id", "leadId", "sellerId") ?? null;
  const callbackAt = raw?.appointment_date || raw?.callbackDate || raw?.callback_date || null;
  return {
    workspace_id:         workspaceId,
    full_name:            pickStr(raw, "name", "fullName", "leadName", "customerName") ?? pickStr(crm, "name", "firstname") ?? "Unknown",
    phone:                pickStr(raw, "toNumber", "fromNumber", "phone", "phoneNumber", "mobile") ?? pickStr(crm, "mobile_number", "mobileNumber") ?? "",
    email:                pickStr(raw, "email", "emailAddress") ?? pickStr(crm, "email") ?? null,
    company_name:         null as string | null,
    status,
    sentiment:            classifySentiment(raw),
    pipeline_stage:       classifyPipelineStage(status),
    qualification_status: classifyQualificationStatus(raw),
    source:               "import",
    source_detail:        SOURCE_DETAIL,
    notes:                pickStr(raw, "notes", "description", "comments"),
    call_summary:         pickStr(raw, "transcript", "callSummary", "summary"),
    callback_date:        callbackAt ?? null,
    meta: {
      wbah_external_id:     externalId,
      wbah_synced_at:       new Date().toISOString(),
      property_address:     pickStr(crm, "new_propinfo_street2", "address1_line1") ?? pickStr(raw, "address", "propertyAddress"),
      property_city:        pickStr(crm, "new_propinfo_city", "address1_city"),
      postcode:             pickStr(crm, "new_propinfo_postalcode", "address1_postalcode") ?? pickStr(raw, "postcode", "postCode"),
      property_type:        pickStr(crm, "property_type"),
      expected_price:       pickStr(raw, "askingPrice", "expectedPrice", "price"),
      assigned_agent:       pickStr(raw, "agentName", "assignedAgent", "agent"),
      agent_name:           pickStr(raw, "agentName", "assignedAgent", "agent"),
      call_status:          raw?.callStatus ?? null,
      call_id:              pickStr(raw, "callId"),
      recording_url:        pickStr(raw, "recordingUrl"),
      transcript:           pickStr(raw, "transcript", "callTranscript"),
      disconnection_reason: pickStr(raw, "disconnectionReason"),
      end_reason:           raw?.endReason ?? raw?.end_reason ?? null,
      duration_ms:          raw?.durationMs ?? null,
      duration_seconds:     raw?.durationSeconds ?? (raw?.durationMs != null ? Math.round(raw.durationMs / 1000) : null),
      appointment_date:     pickStr(raw, "appointment_date"),
      appointment_time:     pickStr(raw, "appointment_time"),
      booking_status:       pickStr(raw, "booking_status"),
      calendly_booking_url: pickStr(raw, "calendlyBookingUrl", "calendly_booking_url", "call_calendly_booking_url"),
      start_timestamp:      raw?.startTimestamp ?? raw?.start_timestamp ?? null,
      last_called_at:       raw?.lastCalledAt ?? raw?.last_called_at ?? raw?.calledAt ?? raw?.call_updatedat ?? null,
      last_call_outcome:    raw?.callStatus ?? raw?.callOutcome ?? raw?.lastCallOutcome ?? null,
      last_call_sentiment:  classifySentiment(raw),
    },
  };
}

function buildContactRow(raw: any, workspaceId: string) {
  const externalId = pickStr(raw, "id", "_id", "lead_id", "buyerId", "contactId") ?? null;
  return {
    workspace_id:     workspaceId,
    name:             pickStr(raw, "name", "fullName", "contact_name", "firstname") ?? "Unknown",
    first_name:       pickStr(raw, "firstname", "firstName", "first_name"),
    last_name:        pickStr(raw, "lastname", "lastName", "last_name"),
    mobile_number:    pickStr(raw, "mobile_number", "mobileNumber", "phone", "phoneNumber") ?? "",
    email:            pickStr(raw, "email", "emailAddress"),
    address_line1:    pickStr(raw, "new_propinfo_street2", "address1_line1", "address"),
    postal_code:      pickStr(raw, "new_propinfo_postalcode", "address1_postalcode", "postcode"),
    city:             pickStr(raw, "new_propinfo_city", "address1_city", "city"),
    client_name:      "Webuyanyhouse",
    lead_external_id: externalId,
    is_active:        raw?.isActive ?? true,
    need_to_call:     raw?.need_to_call ?? false,
    meta: {
      wbah_source:   "crm",
      wbah_synced_at: new Date().toISOString(),
      lead_status:   raw?.lead_status ?? null,
      crm_type:      raw?.crm_type ?? null,
      property_type: raw?.property_type ?? null,
      unique_id:     raw?.unique_id ?? null,
    },
  };
}

// ── Upsert helpers ────────────────────────────────────────────────────────────

async function upsertLeadsRows(sb: ReturnType<typeof getAdminClient>, rows: ReturnType<typeof buildLeadRow>[]): Promise<number> {
  if (!rows.length) return 0;
  const workspaceId = rows[0].workspace_id;
  const { data: existing } = await (sb as any).from("leads").select("id, phone, meta")
    .eq("workspace_id", workspaceId).eq("source", "import").eq("source_detail", SOURCE_DETAIL);
  // Dedup by external ID first (most reliable), then fall back to phone
  const byExternalId = new Map<string, string>();
  const byPhone      = new Map<string, string>();
  for (const l of existing ?? []) {
    const extId = l.meta?.wbah_external_id;
    if (extId) byExternalId.set(String(extId), String(l.id));
    const phone = String(l.phone ?? "").trim();
    if (phone) byPhone.set(phone, String(l.id));
  }
  const toInsert: typeof rows = [];
  const toUpdate: Array<{ id: string } & (typeof rows)[0]> = [];
  for (const row of rows) {
    const extId = row.meta?.wbah_external_id ? String(row.meta.wbah_external_id) : null;
    const phone = String(row.phone ?? "").trim();
    const existingId = (extId && byExternalId.get(extId)) ?? (phone && byPhone.get(phone)) ?? undefined;
    if (existingId) toUpdate.push({ ...row, id: existingId });
    else toInsert.push(row);
  }
  if (toInsert.length) {
    const { error } = await (sb as any).from("leads").insert(toInsert);
    if (error) console.error("[wbah-leads-sync] leads insert error:", error.message);
  }
  for (let i = 0; i < toUpdate.length; i += 50) {
    const batch = toUpdate.slice(i, i + 50);
    await Promise.allSettled(batch.map(({ id, ...row }) => (sb as any).from("leads").update(row).eq("id", id)));
  }
  return rows.length;
}

async function upsertContactRows(sb: ReturnType<typeof getAdminClient>, rows: ReturnType<typeof buildContactRow>[]): Promise<number> {
  if (!rows.length) return 0;
  const workspaceId = rows[0].workspace_id;
  const withId    = rows.filter(r => r.lead_external_id);
  const withoutId = rows.filter(r => !r.lead_external_id);
  if (withId.length) {
    const ids = withId.map(r => r.lead_external_id);
    const { data: existing } = await (sb as any).from("data_records").select("id, lead_external_id")
      .eq("workspace_id", workspaceId).in("lead_external_id", ids);
    const existingSet = new Set((existing ?? []).map((r: any) => r.lead_external_id));
    const existingMap = new Map((existing ?? []).map((r: any) => [r.lead_external_id, r.id]));
    const toInsert = withId.filter(r => !existingSet.has(r.lead_external_id));
    const toUpdate = withId.filter(r =>  existingSet.has(r.lead_external_id));
    if (toInsert.length) await (sb as any).from("data_records").insert(toInsert);
    await Promise.allSettled(toUpdate.map(row => (sb as any).from("data_records").update(row).eq("id", existingMap.get(row.lead_external_id))));
  }
  if (withoutId.length) await (sb as any).from("data_records").insert(withoutId);
  return rows.length;
}

// ── Paginated lead fetch ──────────────────────────────────────────────────────

async function fetchAllLeadRecords(
  getTokens: () => Promise<{ accessToken: string; refreshToken: string }>,
  saveNewAccessToken: (t: string) => Promise<void>,
): Promise<{ ok: boolean; data: any[] }> {
  const { accessToken } = await getTokens();
  const p1 = await apiFetch<any>(`/call-output-data/get-userCall-lead?currentPage=1`, {
    method: "GET", headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!p1.ok || !p1.data) return { ok: false, data: [] };
  const pagination = (p1.data as any)?.pagination ?? {};
  const totalItems = pagination?.totalItems ?? 0;
  const p1Records: any[] = Array.isArray(p1.data?.data) ? [...p1.data.data] : Array.isArray(p1.data) ? [...p1.data] : [];
  // Use actual page size from first response (get-userCall-lead uses pageSize=50, NOT 10)
  const pageSize = p1Records.length || 50;
  const totalPages = totalItems > 0 ? Math.ceil(totalItems / pageSize) : (pagination?.totalPages ?? (p1.data as any)?.totalPages ?? 1);

  // Track IDs to prevent duplicates from over-fetched pages
  const makeId = (r: any): string =>
    String(r?.lead_id ?? r?._id ?? r?.id ?? r?.leadId ?? r?.toNumber ?? "").trim();
  const seenIds = new Set<string>(p1Records.map(makeId).filter(Boolean));
  const all: any[] = [...p1Records];

  console.log(`[wbah-leads-sync] fetchAllLeadRecords: totalItems=${totalItems} pageSize=${pageSize} totalPages=${totalPages}`);

  // Fetch remaining pages in small batches to avoid API rate limits
  for (let page = 2; page <= totalPages; page += 5) {
    const batch = Array.from({ length: Math.min(5, totalPages - page + 1) }, (_, i) => page + i);
    const results = await Promise.allSettled(
      batch.map(p => apiFetch<any>(`/call-output-data/get-userCall-lead?currentPage=${p}`, {
        method: "GET", headers: { Authorization: `Bearer ${accessToken}` },
      }))
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.ok && r.value.data) {
        const records = Array.isArray(r.value.data?.data) ? r.value.data.data : Array.isArray(r.value.data) ? r.value.data : [];
        for (const rec of records) {
          const id = makeId(rec);
          if (id && seenIds.has(id)) continue;
          if (id) seenIds.add(id);
          all.push(rec);
        }
      }
    }
    // Brief pause between batches to avoid hammering the API
    if (page + 5 <= totalPages) await new Promise(res => setTimeout(res, 200));
  }
  console.log(`[wbah-leads-sync] fetchAllLeadRecords done: ${all.length} unique records`);
  return { ok: true, data: all };
}

async function fetchAllBuyers(getTokens: () => Promise<{ accessToken: string; refreshToken: string }>): Promise<{ ok: boolean; data: any[] }> {
  const { accessToken } = await getTokens();
  const res = await apiFetch<any>("/crm-data/get-crm-data", {
    method: "GET", headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok || !res.data) return { ok: false, data: [] };
  const records = Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data) ? res.data : [];
  return { ok: true, data: records };
}

// ── Call row builder ──────────────────────────────────────────────────────────

function buildCallRow(raw: any, workspaceId: string) {
  const id = String(raw.call_id ?? raw._id ?? raw.id ?? "");
  if (!id) return null;
  const rawStatus = (raw.call_status ?? raw.callStatus ?? raw.status ?? "").toLowerCase();
  let callStatus: string;
  if (rawStatus === "ended" || rawStatus === "call_analyzed" || rawStatus === "completed") callStatus = "completed";
  else if (["not_connected","voicemail","voicemail_reached","no_answer","missed"].includes(rawStatus)) callStatus = "no_answer";
  else if (rawStatus === "failed") callStatus = "failed";
  else callStatus = rawStatus || "completed";

  const sentVal = (raw.sentiment_analysis ?? raw.sentimentAnalysis ?? raw.sentiment ?? "").toString().toLowerCase();
  let sentiment: string | null = null;
  if (/positive/.test(sentVal)) sentiment = "positive";
  else if (/neutral/.test(sentVal)) sentiment = "neutral";
  else if (/negative/.test(sentVal)) sentiment = "negative";

  let durationSeconds: number | null = null;
  const dmsRaw = raw.duration_ms ?? raw.durationMs;
  if (dmsRaw && Number(dmsRaw) > 0) durationSeconds = Math.round(Number(dmsRaw) / 1000);
  else if (raw.callDuration) durationSeconds = Number(raw.callDuration) || null;
  else if (raw.duration) {
    const d = Number(raw.duration);
    if (d > 0) durationSeconds = d > 10_000 ? Math.round(d / 1000) : d;
  }

  const startedAt = raw.startTimestamp
    ? new Date(Number(raw.startTimestamp)).toISOString()
    : raw.call_updatedat ?? raw.lastCalledAt ?? raw.last_called_at ?? raw.calledAt ?? raw.createdAt ?? raw.created_at ?? null;

  return {
    id,
    workspace_id:         workspaceId,
    customer_name:        raw.customer_name ?? raw.name ?? raw.fullName ?? raw.contactName ?? null,
    phone:                raw.to_number ?? raw.toNumber ?? raw.mobile_number ?? raw.phone ?? null,
    agent_name:           raw.agentName ?? raw.agent_name ?? raw.assignedAgent ?? null,
    call_status:          callStatus,
    call_type:            "outbound",
    sentiment,
    duration_seconds:     durationSeconds,
    started_at:           startedAt,
    recording_url:        raw.recording_url ?? raw.recordingUrl ?? null,
    transcript:           raw.transcript ?? raw.callTranscript ?? null,
    call_summary:         raw.transcript ?? raw.callTranscript ?? raw.callSummary ?? null,
    disconnection_reason: raw.disconnection_reason ?? raw.disconnectionReason ?? null,
    end_reason:           raw.end_reason ?? raw.endReason ?? null,
    appointment_date:     raw.call_appointment_date ?? raw.appointmentDate ?? raw.appointment_date ?? null,
    appointment_time:     raw.call_appointment_time ?? raw.appointmentTime ?? raw.appointment_time ?? null,
    booking_status:       raw.call_booking_status ?? raw.bookingStatus ?? raw.booking_status ?? null,
    calendly_booking_url: raw.call_calendly_booking_url ?? raw.calendlyBookingUrl ?? raw.calendly_booking_url ?? null,
    call_count:           raw.callCount ?? raw.call_count ?? 1,
    meta:                 {},
    synced_at:            new Date().toISOString(),
  };
}

// ── Paginated call fetch (POST /call-output-data/get-user-history) ────────────

async function fetchAllCallRecords(
  getTokens: () => Promise<{ accessToken: string; refreshToken: string }>,
  refresh: () => Promise<string>,
): Promise<{ ok: boolean; data: any[] }> {
  // The WeeBespoke access token is short-lived and expires mid-run (~11k calls =
  // ~1100 pages takes longer than one token's lifetime). We keep a mutable token
  // and re-login on the first 401 of a batch, so later batches + retries use the
  // fresh token instead of hammering a dead one (which previously 401'd ~1000
  // pages every run and left the table stuck at a few hundred calls).
  let accessToken = (await getTokens()).accessToken;
  const fetchPage = (p: number) =>
    apiFetch<any>(`/call-output-data/get-user-history?currentPage=${p}`, {
      method: "POST", body: "{}", headers: { Authorization: `Bearer ${accessToken}` },
    });

  const p1 = await fetchPage(1);
  if (!p1.ok || !p1.data) return { ok: false, data: [] };
  const pagination = (p1.data as any)?.pagination;
  const p1Recs: any[] = Array.isArray((p1.data as any)?.data) ? (p1.data as any).data : [];
  // The API's pagination.totalPages is unreliable (reports a too-small value);
  // ALWAYS derive page count from totalItems ÷ actual page size, like the leads
  // fetch does. Otherwise the loop terminates early and most calls never sync.
  const totalItems = pagination?.totalItems ?? 0;
  const pageSize   = p1Recs.length || 10;
  const totalPages = totalItems > 0 ? Math.ceil(totalItems / pageSize) : (pagination?.totalPages ?? 1);
  console.log(`[wbah-calls-sync] fetchAllCallRecords: totalItems=${totalItems} pageSize=${pageSize} totalPages=${totalPages}`);

  const all: any[] = [...p1Recs];

  const CONC = 20;
  const runPages = async (pages: number[]): Promise<{ failed: number[]; statuses: Record<string, number> }> => {
    const failed: number[] = [];
    const statuses: Record<string, number> = {};
    for (let i = 0; i < pages.length; i += CONC) {
      const batch = pages.slice(i, i + CONC);
      const results = await Promise.allSettled(batch.map(p => fetchPage(p)));
      let sawAuthExpiry = false;
      results.forEach((r, idx) => {
        if (r.status === "fulfilled" && r.value.ok && r.value.data) {
          const recs = Array.isArray((r.value.data as any)?.data) ? (r.value.data as any).data : [];
          all.push(...recs);
        } else {
          failed.push(batch[idx]);
          const code = r.status === "fulfilled" ? String(r.value.status) : "rejected";
          statuses[code] = (statuses[code] ?? 0) + 1;
          if (r.status === "fulfilled" && (r.value.status === 401 || r.value.status === 403)) sawAuthExpiry = true;
        }
      });
      // Token expired mid-run — re-login once so the next batch (and the retry
      // pass over `failed`) uses a fresh token.
      if (sawAuthExpiry) {
        try { accessToken = await refresh(); console.log("[wbah-calls-sync] token expired mid-run — refreshed"); }
        catch (e: any) { console.log(`[wbah-calls-sync] token refresh failed: ${e?.message ?? e}`); }
      }
    }
    return { failed, statuses };
  };

  let pending = Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => i + 2);
  let res = await runPages(pending);
  console.log(`[wbah-calls-sync] pass 1: got ${all.length}/${totalItems}, failures by status=${JSON.stringify(res.statuses)}`);
  pending = res.failed;
  for (let attempt = 1; attempt <= 6 && pending.length > 0; attempt++) {
    await new Promise(r => setTimeout(r, 500 * attempt));
    res = await runPages(pending);
    console.log(`[wbah-calls-sync] retry ${attempt}: ${pending.length} pages → ${all.length}/${totalItems}, still failing=${res.failed.length}`);
    pending = res.failed;
  }

  console.log(`[wbah-calls-sync] fetched ${all.length} call records (expected ~${totalItems}, unrecovered pages=${pending.length})`);
  return { ok: true, data: all };
}

// ── Upsert calls to wbah_calls ────────────────────────────────────────────────

async function upsertCallRows(sb: ReturnType<typeof getAdminClient>, rows: NonNullable<ReturnType<typeof buildCallRow>>[]): Promise<number> {
  if (!rows.length) return 0;
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await (sb as any).from("wbah_calls").upsert(rows.slice(i, i + BATCH), { onConflict: "id" });
    if (error) console.error("[wbah-calls-sync] upsert error:", error.message);
  }
  return rows.length;
}

// ── Main exported tick functions ──────────────────────────────────────────────

export async function runWbahCallsSyncTick(): Promise<{ calls: number; errors: string[] }> {
  const sb = getAdminClient();
  const { data: ws } = await (sb as any).from("workspaces").select("id").eq("slug", WBAH_SLUG).maybeSingle();
  if (!ws?.id) throw new Error("Webuyanyhouse workspace not found");
  const workspaceId: string = ws.id;

  await ensureFreshToken(sb);
  const getTokens = async () => {
    const tokens = await getStoredTokens(sb);
    if (!tokens) throw new Error("Not connected");
    return tokens;
  };
  const refresh = async () => {
    await ensureFreshToken(sb);
    const t = await getStoredTokens(sb);
    if (!t) throw new Error("Re-login produced no token");
    return t.accessToken;
  };

  const results = { calls: 0, errors: [] as string[] };
  try {
    const callsRes = await fetchAllCallRecords(getTokens, refresh);
    if (callsRes.ok) {
      const rows = callsRes.data.map(r => buildCallRow(r, workspaceId)).filter(Boolean) as NonNullable<ReturnType<typeof buildCallRow>>[];
      results.calls = await upsertCallRows(sb, rows);
    } else {
      results.errors.push("Calls fetch failed");
    }
  } catch (e: any) {
    results.errors.push(e?.message ?? "Unknown error");
  }
  return results;
}

export async function runWbahFullResync(): Promise<{ deleted: number; sellers: number; errors: string[] }> {
  const sb = getAdminClient();
  const { data: ws } = await (sb as any).from("workspaces").select("id").eq("slug", WBAH_SLUG).maybeSingle();
  if (!ws?.id) throw new Error("Webuyanyhouse workspace not found");
  const workspaceId: string = ws.id;

  // 1. Count then delete all existing seller leads for this workspace
  const { count: existing } = await (sb as any)
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("source", "import")
    .eq("source_detail", SOURCE_DETAIL);

  const { error: delErr } = await (sb as any)
    .from("leads")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("source", "import")
    .eq("source_detail", SOURCE_DETAIL);

  if (delErr) throw new Error(`Delete failed: ${delErr.message}`);
  console.log(`[wbah-full-resync] deleted ${existing ?? "?"} stale seller leads`);

  // 2. Refresh token + fetch fresh data
  await ensureFreshToken(sb);
  const getTokens = async () => {
    const tokens = await getStoredTokens(sb);
    if (!tokens) throw new Error("Not connected — no token stored");
    return tokens;
  };
  const saveTok = (t: string) => saveToken(sb, t);

  const sellersRes = await fetchAllLeadRecords(getTokens, saveTok);
  const results = { deleted: existing ?? 0, sellers: 0, errors: [] as string[] };

  if (sellersRes.ok && sellersRes.data) {
    // Fresh insert — no existing rows so all will insert
    const rows = sellersRes.data.map((r: any) => buildLeadRow(r, workspaceId));
    if (rows.length) {
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await (sb as any).from("leads").insert(rows.slice(i, i + CHUNK));
        if (error) results.errors.push(`Insert chunk ${i}: ${error.message}`);
      }
      results.sellers = rows.length;
    }
  } else {
    results.errors.push("Sellers fetch failed — DB was wiped, resync needed");
  }

  console.log(`[wbah-full-resync] inserted ${results.sellers} sellers, ${results.errors.length} errors`);
  return results;
}

export async function runWbahLeadsSyncTick(): Promise<{ sellers: number; contacts: number; errors: string[] }> {
  const sb = getAdminClient();

  // Get workspace
  const { data: ws } = await (sb as any).from("workspaces").select("id").eq("slug", WBAH_SLUG).maybeSingle();
  if (!ws?.id) throw new Error("Webuyanyhouse workspace not found");
  const workspaceId: string = ws.id;

  // Always refresh the token first
  await ensureFreshToken(sb);

  const getTokens = async () => {
    const tokens = await getStoredTokens(sb);
    if (!tokens) throw new Error("Not connected — no token stored");
    return tokens;
  };
  const saveTok = (t: string) => saveToken(sb, t);

  const [sellersRes, buyersRes] = await Promise.allSettled([
    fetchAllLeadRecords(getTokens, saveTok),
    fetchAllBuyers(getTokens),
  ]);

  const results = { sellers: 0, contacts: 0, errors: [] as string[] };

  if (sellersRes.status === "fulfilled" && sellersRes.value.ok) {
    results.sellers = await upsertLeadsRows(sb, sellersRes.value.data.map((r: any) => buildLeadRow(r, workspaceId)));
  } else {
    results.errors.push(sellersRes.status === "rejected" ? sellersRes.reason?.message : "Sellers sync failed");
  }

  if (buyersRes.status === "fulfilled" && buyersRes.value.ok) {
    results.contacts = await upsertContactRows(sb, buyersRes.value.data.map((r: any) => buildContactRow(r, workspaceId)));
  } else {
    results.errors.push(buyersRes.status === "rejected" ? buyersRes.reason?.message : "Contacts sync failed");
  }

  return results;
}
