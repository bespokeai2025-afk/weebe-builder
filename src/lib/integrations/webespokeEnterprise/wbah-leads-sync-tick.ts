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
import { isWbahRecordBooked, isWbahBookingStatus, phoneDigits } from "../../dashboard/wbah-booking-meta";

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
    // Call ended but no human was reached (voicemail, dead air / inactivity, no answer).
    // The real signal lives in endReason ("voicemail_reached" / "inactivity") as much as
    // disconnectionReason. This MUST run BEFORE the positive/neutral check — otherwise
    // every voicemail with neutral sentiment (the vast majority of WBAH calls) was being
    // mis-counted as "qualified".
    const reached = `${(raw?.disconnectionReason ?? "").toLowerCase()} ${(raw?.endReason ?? "").toLowerCase()}`;
    if (/voicemail|no_answer|no_input|dial_no_answer|inactivity/.test(reached)) return "not_connected";
    if (/positive|neutral/.test(sa)) return "qualified";
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
  refresh: () => Promise<string>,
): Promise<{ ok: boolean; data: any[] }> {
  // The WeeBespoke account uses a single active session, so a concurrent sync
  // (the calls sync re-logs in mid-run) can invalidate the token we were handed,
  // making later pages 401 and silently drop — which left leads stuck at ~1300
  // of ~1569. Keep a mutable token, re-login on failure, and retry dropped pages.
  let accessToken = (await getTokens()).accessToken;
  const fetchPage = (p: number) => apiFetch<any>(`/call-output-data/get-userCall-lead?currentPage=${p}`, {
    method: "GET", headers: { Authorization: `Bearer ${accessToken}` },
  });
  const refreshOnce = async () => {
    try { accessToken = await refresh(); console.log("[wbah-leads-sync] token expired mid-fetch — refreshed"); }
    catch (e: any) { console.log(`[wbah-leads-sync] token refresh failed: ${e?.message ?? e}`); }
  };

  let p1 = await fetchPage(1);
  if (!p1.ok || !p1.data) { await refreshOnce(); p1 = await fetchPage(1); }
  if (!p1.ok || !p1.data) return { ok: false, data: [] };

  const pagination = (p1.data as any)?.pagination ?? {};
  const totalItems = pagination?.totalItems ?? 0;
  const p1Records: any[] = Array.isArray(p1.data?.data) ? [...p1.data.data] : Array.isArray(p1.data) ? [...p1.data] : [];
  // Use actual page size from first response (get-userCall-lead uses pageSize=50, NOT 10)
  const pageSize = p1Records.length || 50;
  const totalPages = totalItems > 0 ? Math.ceil(totalItems / pageSize) : (pagination?.totalPages ?? (p1.data as any)?.totalPages ?? 1);

  // Track IDs to prevent duplicates from over-fetched / retried pages
  const makeId = (r: any): string =>
    String(r?.lead_id ?? r?._id ?? r?.id ?? r?.leadId ?? r?.toNumber ?? "").trim();
  const seenIds = new Set<string>(p1Records.map(makeId).filter(Boolean));
  const all: any[] = [...p1Records];

  console.log(`[wbah-leads-sync] fetchAllLeadRecords: totalItems=${totalItems} pageSize=${pageSize} totalPages=${totalPages}`);

  const pushRecs = (data: any) => {
    const records = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    for (const rec of records) {
      const id = makeId(rec);
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      all.push(rec);
    }
  };

  const runPages = async (pages: number[]): Promise<number[]> => {
    const failed: number[] = [];
    for (let i = 0; i < pages.length; i += 5) {
      const batch = pages.slice(i, i + 5);
      const results = await Promise.allSettled(batch.map(p => fetchPage(p)));
      let sawFail = false;
      results.forEach((r, idx) => {
        if (r.status === "fulfilled" && r.value.ok && r.value.data) pushRecs(r.value.data);
        else { failed.push(batch[idx]); sawFail = true; }
      });
      if (sawFail) await refreshOnce();
      await new Promise(res => setTimeout(res, 150));
    }
    return failed;
  };

  let pending = Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => i + 2);
  pending = await runPages(pending);
  for (let attempt = 1; attempt <= 3 && pending.length > 0; attempt++) {
    await new Promise(r => setTimeout(r, 500 * attempt));
    pending = await runPages(pending);
  }

  console.log(`[wbah-leads-sync] fetchAllLeadRecords done: ${all.length} unique records (unrecovered pages=${pending.length})`);
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

const BOOKING_FIELDS = ["appointment_date", "appointment_time", "booking_status", "calendly_booking_url"] as const;

// A genuine Retell call_id always looks like `call_<hex>` (see
// buildRetellCallRow in wbah-retell-calls-sync.ts). WeeBespoke's own
// get-user-history record usually carries that same call_id, but for a small
// fraction of records it's missing and buildCallRow falls back to
// WeeBespoke's internal `_id`/`id` — a value that will never match Retell's
// row. Combined with buildCallRow's started_at fallback (which lands near the
// call's END time, not its start, when `startTimestamp` is absent), these
// "weak id" rows silently create a SECOND wbah_calls row for a call Retell
// already synced — customers see the same call listed twice, looking like a
// start-time row and an end-time row.
function isWeakCallId(id: string): boolean {
  return !/^call_/.test(id);
}

// Detects wbah_calls rows built from a "weak id" WeeBespoke record that are
// actually the SAME physical call as an existing Retell-sourced row (matched
// by phone + call-end-time proximity). Any booking info on the WeeBespoke row
// is merged onto the Retell row so it isn't lost, and the WeeBespoke row's id
// is returned so the caller can skip inserting it as a duplicate.
async function dedupeAgainstRetellRows(
  sb: ReturnType<typeof getAdminClient>,
  rows: NonNullable<ReturnType<typeof buildCallRow>>[],
): Promise<Set<string>> {
  const skip = new Set<string>();
  const weakRows = rows.filter((r) => isWeakCallId(r.id) && r.phone && r.started_at);
  if (!weakRows.length) return skip;

  const workspaceId = weakRows[0].workspace_id;
  const phones = Array.from(new Set(weakRows.map((r) => r.phone as string)));

  // PostgREST caps a single response at 1000 rows — a chunk of many phones
  // can easily have >1000 combined retell rows (busy numbers dominate),
  // which would silently truncate the result and drop rows for other phones
  // in the chunk with no error. Query a handful of phones per request and
  // paginate each one until exhausted.
  const PHONE_CHUNK = 20;
  const PAGE = 1000;
  const byPhone = new Map<string, any[]>();
  for (let i = 0; i < phones.length; i += PHONE_CHUNK) {
    const chunk = phones.slice(i, i + PHONE_CHUNK);
    let from = 0;
    while (true) {
      const { data: retellRows, error } = await (sb as any)
        .from("wbah_calls")
        .select("id, phone, started_at, duration_seconds, appointment_date, appointment_time, booking_status, calendly_booking_url")
        .eq("workspace_id", workspaceId)
        .eq("meta->>source", "retell")
        .in("phone", chunk)
        .range(from, from + PAGE - 1);
      if (error) break;
      const rows = (retellRows ?? []) as any[];
      for (const r of rows) {
        const arr = byPhone.get(r.phone) ?? [];
        arr.push(r);
        byPhone.set(r.phone, arr);
      }
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }
  if (!byPhone.size) return skip;

  const bookingUpdates = new Map<string, Record<string, any>>();
  for (const row of weakRows) {
    const candidates = byPhone.get(row.phone as string) ?? [];
    const rowStart = Date.parse(String(row.started_at));
    if (!Number.isFinite(rowStart)) continue;
    for (const c of candidates) {
      const cStart = c.started_at ? Date.parse(String(c.started_at)) : NaN;
      if (!Number.isFinite(cStart)) continue;
      const expectedEnd = cStart + (c.duration_seconds ?? 0) * 1000;
      const durationsClose = row.duration_seconds == null || c.duration_seconds == null
        ? true
        : Math.abs(row.duration_seconds - c.duration_seconds) <= 3;
      // WeeBespoke's fallback started_at lands within a few seconds of the
      // call's real end — 90s covers sync-delay jitter without risking a
      // false match against an unrelated call from the same number.
      if (durationsClose && Math.abs(rowStart - expectedEnd) <= 90_000) {
        skip.add(String(row.id));
        const patch: Record<string, any> = {};
        for (const f of BOOKING_FIELDS) {
          const cur = c[f];
          const incoming = (row as any)[f];
          if ((cur == null || String(cur).trim() === "") && incoming != null && String(incoming).trim() !== "") {
            patch[f] = incoming;
          }
        }
        if (Object.keys(patch).length) {
          bookingUpdates.set(String(c.id), { ...(bookingUpdates.get(String(c.id)) ?? {}), ...patch });
        }
        break;
      }
    }
  }

  for (const [id, patch] of bookingUpdates) {
    const { error: updErr } = await (sb as any).from("wbah_calls").update(patch).eq("id", id);
    if (updErr) console.error("[wbah-calls-sync] booking merge error:", updErr.message);
  }
  return skip;
}

async function upsertCallRows(sb: ReturnType<typeof getAdminClient>, rows: NonNullable<ReturnType<typeof buildCallRow>>[]): Promise<number> {
  if (!rows.length) return 0;
  const skipIds = await dedupeAgainstRetellRows(sb, rows);
  const rowsToUpsert = skipIds.size ? rows.filter((r) => !skipIds.has(String(r.id))) : rows;
  if (!rowsToUpsert.length) return 0;

  const ids = rowsToUpsert.map((r) => r.id);
  const { data: existing } = await (sb as any)
    .from("wbah_calls")
    .select("id, appointment_date, appointment_time, booking_status, calendly_booking_url")
    .in("id", ids);
  const byId = new Map<string, any>(((existing ?? []) as any[]).map((e) => [String(e.id), e]));
  const merged = rowsToUpsert.map((row) => {
    const prev = byId.get(String(row.id));
    if (!prev) return row;
    const out = { ...row };
    for (const f of BOOKING_FIELDS) {
      const next = out[f];
      const kept = prev[f];
      if ((next == null || String(next).trim() === "") && kept != null && String(kept).trim() !== "") {
        out[f] = kept;
      }
    }
    return out;
  });
  const BATCH = 200;
  for (let i = 0; i < merged.length; i += BATCH) {
    const { error } = await (sb as any).from("wbah_calls").upsert(merged.slice(i, i + BATCH), { onConflict: "id" });
    if (error) console.error("[wbah-calls-sync] upsert error:", error.message);
  }
  return merged.length;
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

// ── Incremental live refresh — newest calls only, upsert to wbah_calls ─────────
//
// Powers the "live on open" Calls + Leads pages. Reuses the STORED token and only
// re-logs-in on a 401 — so on the common path it does NOT create a fresh
// WeeBespoke session and therefore does NOT kick the human admin out of their
// dashboard.
//
// IMPORTANT: get-user-history paginates OLDEST-first, so the newest calls live on
// the LAST page — NOT page 1. Walking pages 1..N (the old approach) only ever saw
// ancient calls that were already in the DB, declared "caught up" after a few
// pages, and never fetched anything recent. We now probe BOTH ends, detect which
// holds the newest calls, and walk inward from there in concurrent batches,
// stopping once a batch reaches back to what the DB already had (dbMax). Capped at
// INCR_MAX_PAGES so a huge backlog can't hang the request; the rest converges over
// subsequent opens.
let _incrInFlight: Promise<{ calls: number; pages: number; caughtUp: boolean; errors: string[] }> | null = null;
let _incrLastRunAt = 0;
const INCR_MIN_INTERVAL_MS = 55_000;
// Sized so the one-time backfill after a long sync outage (currently ~260 pages /
// ~9 days at ~290 calls/day) completes in a SINGLE run — otherwise a capped run
// leaves a permanent hole in the middle (dbMax-based stopping can't detect a gap
// that sits older than the newest already-synced call). Steady state stops at the
// boundary long before this, so a high cap costs nothing on the common path.
const INCR_MAX_PAGES = 400;
const INCR_BATCH = 20;

// Epoch (ms) for a raw call record, mirroring buildCallRow's started_at logic, so
// we can compare recency across pages and against the DB's current max.
function recEpoch(rec: any): number {
  const ts = rec?.startTimestamp;
  if (ts != null && Number(ts) > 0) return Number(ts);
  const s = rec?.call_updatedat ?? rec?.lastCalledAt ?? rec?.last_called_at ?? rec?.calledAt ?? rec?.createdAt ?? rec?.created_at ?? null;
  if (!s) return 0;
  const t = Date.parse(String(s));
  return Number.isFinite(t) ? t : 0;
}
function maxEpoch(recs: any[]): number {
  let m = 0;
  for (const r of recs) { const e = recEpoch(r); if (e > m) m = e; }
  return m;
}
// Smallest POSITIVE epoch in a batch (ignores records with unparseable dates so a
// single bad row can't falsely signal "reached the boundary"). Infinity if none.
function minEpochPositive(recs: any[]): number {
  let m = Infinity;
  for (const r of recs) { const e = recEpoch(r); if (e > 0 && e < m) m = e; }
  return m;
}

export async function refreshWbahCallsIncremental(): Promise<{ calls: number; pages: number; caughtUp: boolean; errors: string[] }> {
  // Concurrency guard: dedupe overlapping calls (React StrictMode, or Calls +
  // Leads opened together) so we never run two syncs fighting over the single
  // WeeBespoke session. In-flight promise handles concurrent races; the timestamp
  // skips a re-sync if one just completed.
  if (_incrInFlight) return _incrInFlight;
  if (Date.now() - _incrLastRunAt < INCR_MIN_INTERVAL_MS) {
    return { calls: 0, pages: 0, caughtUp: true, errors: [] };
  }
  _incrInFlight = (async () => {
    const sb = getAdminClient();
    const { data: ws } = await (sb as any).from("workspaces").select("id").eq("slug", WBAH_SLUG).maybeSingle();
    if (!ws?.id) throw new Error("Webuyanyhouse workspace not found");
    const workspaceId: string = ws.id;

    const errors: string[] = [];
    const tokens = await getStoredTokens(sb);
    // No stored session → do NOT force a login here (that would kick the admin);
    // serve whatever is already in the DB. A proactive re-login happens elsewhere.
    if (!tokens) return { calls: 0, pages: 0, caughtUp: false, errors: ["Not connected"] };
    let accessToken = tokens.accessToken;

    // Shared, generation-tracked re-login. Under concurrency (a 20-page batch) the
    // token can expire and ALL 20 requests 401 at once — without coordination each
    // would trigger its own login (session thrash) or, worse, skip the retry and
    // silently drop its page. Here every 401'd fetch awaits ONE shared re-login for
    // its token generation; a fetch whose generation is already stale just reuses
    // the fresh token. The token can legitimately expire more than once during a
    // ~260-page backfill, so a NEW generation can re-login again (unlike a one-shot
    // flag). The stored-token happy path still never logs in.
    let tokenGen = 0;
    let reloginInFlight: Promise<void> | null = null;
    const reloginForGen = (seenGen: number): Promise<void> => {
      if (tokenGen > seenGen) return Promise.resolve(); // already refreshed by a peer
      if (!reloginInFlight) {
        reloginInFlight = (async () => {
          try {
            await ensureFreshToken(sb);
            const t = await getStoredTokens(sb);
            if (t) { accessToken = t.accessToken; tokenGen++; }
          } catch (e: any) { errors.push(`relogin failed: ${e?.message ?? e}`); }
          finally { reloginInFlight = null; }
        })();
      }
      return reloginInFlight;
    };

    // Fetch one page; on 401/403 refresh (once per generation) and retry once.
    // Returns recs + the pagination block (needed to locate the newest page).
    const fetchPage = async (p: number): Promise<{ ok: boolean; status: number; recs: any[]; pagination: any }> => {
      const url = `/call-output-data/get-user-history?currentPage=${p}`;
      const genUsed = tokenGen;
      let res = await apiFetch<any>(url, { method: "POST", body: "{}", headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok && (res.status === 401 || res.status === 403)) {
        await reloginForGen(genUsed);
        res = await apiFetch<any>(url, { method: "POST", body: "{}", headers: { Authorization: `Bearer ${accessToken}` } });
      }
      const recs: any[] = res.ok && res.data && Array.isArray((res.data as any)?.data) ? (res.data as any).data : [];
      if (!res.ok) errors.push(`page ${p} failed: status=${res.status}`);
      return { ok: res.ok, status: res.status, recs, pagination: (res.data as any)?.pagination };
    };

    // Upsert a set of raw records (idempotent so late transcript/status updates
    // refresh even when the id is known). Returns how many were NEW.
    const upsertRecs = async (recs: any[]): Promise<{ built: number; newCount: number }> => {
      const rows = recs.map(r => buildCallRow(r, workspaceId)).filter(Boolean) as NonNullable<ReturnType<typeof buildCallRow>>[];
      const ids = rows.map(r => r.id);
      let existingSet = new Set<string>();
      if (ids.length) {
        const { data: existing } = await (sb as any)
          .from("wbah_calls").select("id").eq("workspace_id", workspaceId).in("id", ids);
        existingSet = new Set(((existing ?? []) as any[]).map(e => String(e.id)));
      }
      await upsertCallRows(sb, rows);
      const known = ids.filter(id => existingSet.has(id)).length;
      return { built: rows.length, newCount: ids.length - known };
    };

    // Newest call we already have. Everything strictly newer than this is the gap
    // to backfill; walking newest→older, once a batch reaches back to this we stop.
    let dbMaxEpoch = 0;
    {
      const { data: mx } = await (sb as any)
        .from("wbah_calls").select("started_at").eq("workspace_id", workspaceId)
        .not("started_at", "is", null).order("started_at", { ascending: false }).limit(1);
      const s = (mx as any[])?.[0]?.started_at;
      if (s) { const t = Date.parse(String(s)); if (Number.isFinite(t)) dbMaxEpoch = t; }
    }

    // Probe page 1 for pagination + the page-1-end sample.
    const first = await fetchPage(1);
    if (!first.ok) {
      _incrLastRunAt = Date.now();
      console.log(`[wbah-calls-incr] page1 failed — serving DB snapshot; errors=${errors.length}`);
      return { calls: 0, pages: 1, caughtUp: false, errors };
    }
    const totalItems = first.pagination?.totalItems ?? 0;
    const pageSize = first.recs.length || 10;
    const lastPage = totalItems > 0 ? Math.ceil(totalItems / pageSize) : 1;

    const cache = new Map<number, any[]>();
    cache.set(1, first.recs);

    // Only one page of history → upsert it and we're done.
    if (lastPage <= 1) {
      const r = await upsertRecs(first.recs);
      _incrLastRunAt = Date.now();
      console.log(`[wbah-calls-incr] single page; new=${r.newCount} total=${totalItems}`);
      return { calls: r.newCount, pages: 1, caughtUp: true, errors };
    }

    // Detect which end holds the newest calls (robust to a future sort-order change).
    // If the last-page probe fails we DEFAULT to newest-at-end, because the API is
    // known to be oldest-first — a failed probe must never flip us into walking the
    // oldest pages (which would fetch ancient calls and false-"caught up" instantly).
    const last = await fetchPage(lastPage);
    if (last.ok) cache.set(lastPage, last.recs);
    const newestAtEnd = last.ok ? maxEpoch(last.recs) >= maxEpoch(first.recs) : true;

    // Ordered page list, newest → oldest.
    const order: number[] = [];
    if (newestAtEnd) { for (let p = lastPage; p >= 1; p--) order.push(p); }
    else { for (let p = 1; p <= lastPage; p++) order.push(p); }

    let newCount = 0;
    let pagesFetched = 0;
    let caughtUp = false;

    for (let i = 0; i < order.length && pagesFetched < INCR_MAX_PAGES && !caughtUp; i += INCR_BATCH) {
      const batchPages = order.slice(i, i + INCR_BATCH);
      const fetchOne = async (p: number) => {
        const cached = cache.get(p);
        if (cached) return { p, ok: true, recs: cached };
        const r = await fetchPage(p);
        return { p, ok: r.ok, recs: r.recs };
      };
      let results = await Promise.all(batchPages.map(fetchOne));
      // Retry any failed pages once — by now a 401 has triggered a shared re-login,
      // so the retry runs with a fresh token instead of dropping the page.
      const failed = results.filter(r => !r.ok).map(r => r.p);
      if (failed.length) {
        const retried = await Promise.all(failed.map(fetchOne));
        for (const rr of retried) {
          const idx = results.findIndex(x => x.p === rr.p);
          if (idx >= 0) results[idx] = rr;
        }
      }
      const anyFailed = results.some(r => !r.ok);
      const flat = results.flatMap(r => r.recs);
      pagesFetched += batchPages.length;

      const r = await upsertRecs(flat);
      newCount += r.newCount;

      // Only conclude "caught up" from a CLEAN batch. If any page in this batch
      // failed to fetch (even after retry), a dropped page could masquerade as the
      // boundary or an empty batch and leave a permanent hole — so keep walking.
      if (!anyFailed) {
        const batchMin = minEpochPositive(flat);
        if (flat.length === 0) caughtUp = true;                                  // genuine end of history
        else if (dbMaxEpoch > 0 && batchMin <= dbMaxEpoch) caughtUp = true;      // reached existing data
        else if (r.built > 0 && r.newCount === 0) caughtUp = true;              // whole batch already known
      }
    }

    // Cap hit without catching up → the gap is larger than INCR_MAX_PAGES; the
    // newest pages are synced but an older slice remains. Warn loudly so it's
    // visible (a manual full resync closes it; dbMax-based stopping won't).
    if (!caughtUp && pagesFetched >= INCR_MAX_PAGES) {
      console.warn(`[wbah-calls-incr] hit page cap (${INCR_MAX_PAGES}) before catching up — gap may exceed cap; older calls not yet backfilled`);
    }

    _incrLastRunAt = Date.now();
    console.log(`[wbah-calls-incr] pages=${pagesFetched} new=${newCount} caughtUp=${caughtUp} newestAtEnd=${newestAtEnd} lastPage=${lastPage} total=${totalItems} dbMax=${dbMaxEpoch ? new Date(dbMaxEpoch).toISOString() : "none"} errors=${errors.length}`);
    return { calls: newCount, pages: pagesFetched, caughtUp, errors };
  })();

  try { return await _incrInFlight; }
  finally { _incrInFlight = null; }
}

// Re-fetch the newest N pages from WeeBespoke to restore Calendly / appointment
// fields that Retell upserts clear. Throttled separately from the incremental gap
// filler so every Leads/Calls open repopulates recent bookings without walking
// the full history.
let _apptBackfillAt = 0;
let _apptBackfillInflight: Promise<{ rows: number }> | null = null;
const APPT_BACKFILL_MS = 5 * 60 * 1000;
const APPT_BACKFILL_PAGES = 15;

export async function refreshWbahAppointmentBackfill(opts?: { maxPages?: number; force?: boolean }): Promise<{ rows: number }> {
  if (_apptBackfillInflight) return _apptBackfillInflight;
  if (!opts?.force && Date.now() - _apptBackfillAt < APPT_BACKFILL_MS) return { rows: 0 };

  const maxPages = opts?.maxPages ?? APPT_BACKFILL_PAGES;

  _apptBackfillInflight = (async () => {
    const sb = getAdminClient();
    const { data: ws } = await (sb as any).from("workspaces").select("id").eq("slug", WBAH_SLUG).maybeSingle();
    if (!ws?.id) return { rows: 0 };
    const workspaceId: string = ws.id;
    const tokens = await getStoredTokens(sb);
    if (!tokens) return { rows: 0 };

    let accessToken = tokens.accessToken;
    const fetchPage = async (p: number) => {
      const url = `/call-output-data/get-user-history?currentPage=${p}`;
      return apiFetch<any>(url, { method: "POST", body: "{}", headers: { Authorization: `Bearer ${accessToken}` } });
    };

    const p1 = await fetchPage(1);
    if (!p1.ok || !p1.data) return { rows: 0 };
    const p1Recs: any[] = Array.isArray((p1.data as any)?.data) ? (p1.data as any).data : [];
    const pagination = (p1.data as any)?.pagination ?? {};
    const totalItems = pagination?.totalItems ?? 0;
    const pageSize = p1Recs.length || 10;
    const lastPage = totalItems > 0 ? Math.ceil(totalItems / pageSize) : 1;

    const last = lastPage > 1 ? await fetchPage(lastPage) : p1;
    const lastRecs: any[] = last.ok && last.data && Array.isArray((last.data as any)?.data) ? (last.data as any).data : p1Recs;
    const newestAtEnd = maxEpoch(lastRecs) >= maxEpoch(p1Recs);

    const pages: number[] = [];
    if (newestAtEnd) {
      for (let p = lastPage; p >= Math.max(1, lastPage - maxPages + 1); p--) pages.push(p);
    } else {
      for (let p = 1; p <= Math.min(lastPage, maxPages); p++) pages.push(p);
    }

    let total = 0;
    for (const p of pages) {
      const res = p === 1 ? p1 : await fetchPage(p);
      const recs: any[] = res.ok && res.data && Array.isArray((res.data as any)?.data) ? (res.data as any).data : [];
      if (!recs.length) continue;
      const rows = recs.map((r) => buildCallRow(r, workspaceId)).filter(Boolean) as NonNullable<ReturnType<typeof buildCallRow>>[];
      total += await upsertCallRows(sb, rows);
    }

    _apptBackfillAt = Date.now();
    console.log(`[wbah-appt-backfill] upserted=${total} pages=${pages.length}`);
    return { rows: total };
  })();

  try { return await _apptBackfillInflight; }
  finally { _apptBackfillInflight = null; }
}

// ── Booked appointments from get-all-calldata ────────────────────────────────
// Calendly bookings live in the CRM feed (booking_status=success) with full
// appointment_date/time/url. get-user-history does NOT carry these fields on
// completed calls, so wbah_calls alone can never populate the Qualified page
// or calendar. Persist booked CRM rows separately — never prune them when the
// non-booked People sync runs.

function isBookedCrmRecord(raw: any): boolean {
  return isWbahRecordBooked({
    appointment_date: raw?.call_appointment_date ?? raw?.appointmentDate ?? raw?.appointment_date ?? null,
    appointment_time: raw?.call_appointment_time ?? raw?.appointmentTime ?? raw?.appointment_time ?? null,
    booking_status: raw?.call_booking_status ?? raw?.bookingStatus ?? raw?.booking_status ?? null,
    calendly_booking_url:
      raw?.call_calendly_booking_url ?? raw?.calendlyBookingUrl ?? raw?.calendly_booking_url ?? raw?.calendlyUrl ?? null,
  });
}

function buildBookedCrmRow(raw: any, workspaceId: string) {
  const phone = raw.toNumber ?? raw.fromNumber ?? raw.phone ?? null;
  const dedup = phone && String(phone).trim()
    ? String(phone).trim()
    : `id:${raw.lead_id ?? raw.callId ?? raw.id}`;
  const sent = raw.sentimentAnalysis ?? raw.sentiment ?? null;
  const appointment_date = raw.call_appointment_date ?? raw.appointmentDate ?? raw.appointment_date ?? null;
  const appointment_time = raw.call_appointment_time ?? raw.appointmentTime ?? raw.appointment_time ?? null;
  const booking_status = raw.call_booking_status ?? raw.bookingStatus ?? raw.booking_status ?? "success";
  const calendly_booking_url =
    raw.call_calendly_booking_url ?? raw.calendlyBookingUrl ?? raw.calendly_booking_url ?? raw.calendlyUrl ?? null;
  return {
    dedup_key:            dedup,
    workspace_id:         workspaceId,
    external_id:          String(raw.lead_id ?? raw.callId ?? raw.id ?? ""),
    phone,
    name:                 raw.name ?? raw.fullName ?? null,
    email:                raw.email ?? null,
    lead_status:          raw.lead_status ?? raw.crmData?.lead_status ?? "Booked",
    call_status:          raw.callStatus ?? null,
    sentiment:            typeof sent === "string" ? sent : null,
    disconnection_reason: raw.disconnectionReason ?? null,
    end_reason:           raw.endReason ?? null,
    agent_name:           raw.agentName ?? raw.agent_name ?? null,
    duration_ms:          raw.durationMs != null ? Number(raw.durationMs) : null,
    start_timestamp:      raw.startTimestamp != null ? Number(raw.startTimestamp) : null,
    recording_url:        raw.recordingUrl ?? null,
    transcript:           raw.transcript ?? null,
    appointment_date,
    appointment_time,
    booking_status,
    calendly_booking_url,
    crm_loaded_at:        raw.createdAt ?? raw.created_at ?? null,
    synced_at:            new Date().toISOString(),
    meta:                 { wbah_booked: true },
  };
}

let _bookedSyncAt = 0;
let _bookedSyncInflight: Promise<{ rows: number }> | null = null;
const BOOKED_SYNC_MS = 3 * 60 * 1000;

export async function syncWbahBookedContactsFromCrm(opts?: { force?: boolean }): Promise<{ rows: number }> {
  if (_bookedSyncInflight) return _bookedSyncInflight;
  if (!opts?.force && Date.now() - _bookedSyncAt < BOOKED_SYNC_MS) return { rows: 0 };

  _bookedSyncInflight = (async () => {
    const sb = getAdminClient();
    const { data: ws } = await (sb as any).from("workspaces").select("id").eq("slug", WBAH_SLUG).maybeSingle();
    if (!ws?.id) return { rows: 0 };
    const workspaceId: string = ws.id;

    let accessToken = (await getStoredTokens(sb))?.accessToken;
    const fetchPage = async (p: number) => {
      const url = `/call-output-data/get-all-calldata?currentPage=${p}`;
      return apiFetch<any>(url, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
    };

    let p1 = await fetchPage(1);
    if (!p1.ok || !p1.data) {
      await ensureFreshToken(sb);
      accessToken = (await getStoredTokens(sb))?.accessToken;
      if (!accessToken) return { rows: 0 };
      p1 = await fetchPage(1);
    }
    if (!p1.ok || !p1.data) return { rows: 0 };
    const pag = (p1.data as any)?.pagination ?? {};
    const totalPages = Number(pag.totalPages ?? 1) || 1;

    const booked: ReturnType<typeof buildBookedCrmRow>[] = [];
    const seen = new Set<string>();
    const ingest = (recs: any[]) => {
      for (const r of recs) {
        if (!isBookedCrmRecord(r)) continue;
        const row = buildBookedCrmRow(r, workspaceId);
        if (seen.has(row.dedup_key)) continue;
        seen.add(row.dedup_key);
        booked.push(row);
      }
    };

    ingest(Array.isArray((p1.data as any)?.data) ? (p1.data as any).data : []);
    for (let p = 2; p <= totalPages; p++) {
      const res = await fetchPage(p);
      if (!res.ok || !res.data) continue;
      ingest(Array.isArray((res.data as any)?.data) ? (res.data as any).data : []);
    }

    if (!booked.length) return { rows: 0 };

    for (let i = 0; i < booked.length; i += 200) {
      const chunk = booked.slice(i, i + 200);
      const { error } = await (sb as any)
        .from("wbah_crm_contacts")
        .upsert(chunk, { onConflict: "workspace_id,dedup_key" });
      if (error) console.error("[wbah-booked-sync] upsert error:", error.message);
    }

    _bookedSyncAt = Date.now();
    console.log(`[wbah-booked-sync] upserted=${booked.length} from get-all-calldata`);
    return { rows: booked.length };
  })();

  try { return await _bookedSyncInflight; }
  finally { _bookedSyncInflight = null; }
}

// ── Booked appointments from wbah_calls (appointment backfill / Retell gap) ─
// Some bookings exist on call history but never appear in get-all-calldata. Upsert
// them into wbah_crm_contacts so Qualified / Calendar / Pipeline can find them.

function buildBookedCallRow(call: any, workspaceId: string) {
  const phone = call.phone ?? null;
  const dedup = phone && String(phone).trim()
    ? String(phone).trim()
    : `id:${call.id}`;
  return {
    dedup_key:            dedup,
    workspace_id:         workspaceId,
    external_id:          String(call.id),
    phone,
    name:                 call.customer_name ?? null,
    email:                null,
    lead_status:          "Booked",
    call_status:          call.call_status ?? null,
    sentiment:            call.sentiment ?? null,
    disconnection_reason: call.disconnection_reason ?? null,
    end_reason:           call.end_reason ?? null,
    agent_name:           call.agent_name ?? null,
    duration_ms:          call.duration_seconds != null ? Number(call.duration_seconds) * 1000 : null,
    start_timestamp:      call.started_at ? Date.parse(String(call.started_at)) || null : null,
    recording_url:        call.recording_url ?? null,
    transcript:           call.transcript ?? call.call_summary ?? null,
    appointment_date:     call.appointment_date ?? null,
    appointment_time:     call.appointment_time ?? null,
    booking_status:       call.booking_status ?? "booked",
    calendly_booking_url: call.calendly_booking_url ?? null,
    crm_loaded_at:        call.started_at ?? null,
    synced_at:            new Date().toISOString(),
    meta:                 { wbah_booked: true, wbah_source: "wbah_calls" },
  };
}

function bookingRowScore(row: ReturnType<typeof buildBookedCallRow>): number {
  let score = 0;
  if (row.appointment_date && String(row.appointment_date).trim()) score += 4;
  if (row.appointment_time && String(row.appointment_time).trim()) score += 2;
  if (row.calendly_booking_url && String(row.calendly_booking_url).trim()) score += 3;
  if (isWbahBookingStatus(row.booking_status)) score += 1;
  return score;
}

let _bookedCallsSyncAt = 0;
let _bookedCallsSyncInflight: Promise<{ rows: number }> | null = null;
const BOOKED_CALLS_SYNC_MS = 3 * 60 * 1000;

export async function syncWbahBookedContactsFromCalls(opts?: { force?: boolean }): Promise<{ rows: number }> {
  if (_bookedCallsSyncInflight) return _bookedCallsSyncInflight;
  if (!opts?.force && Date.now() - _bookedCallsSyncAt < BOOKED_CALLS_SYNC_MS) return { rows: 0 };

  _bookedCallsSyncInflight = (async () => {
    const sb = getAdminClient();
    const { data: ws } = await (sb as any).from("workspaces").select("id").eq("slug", WBAH_SLUG).maybeSingle();
    if (!ws?.id) return { rows: 0 };
    const workspaceId: string = ws.id;

    const COLS =
      "id, customer_name, phone, agent_name, call_status, sentiment, duration_seconds, started_at, recording_url, transcript, call_summary, disconnection_reason, end_reason, appointment_date, appointment_time, booking_status, calendly_booking_url";
    const byDigits = new Map<string, ReturnType<typeof buildBookedCallRow>>();
    const PAGE = 1000;
    let from = 0;

    for (;;) {
      const { data, error } = await (sb as any)
        .from("wbah_calls")
        .select(COLS)
        .eq("workspace_id", workspaceId)
        .order("started_at", { ascending: false, nullsFirst: false })
        .range(from, from + PAGE - 1);
      if (error) {
        console.error("[wbah-booked-calls-sync] read error:", error.message);
        break;
      }
      const batch = (data ?? []) as any[];
      for (const call of batch) {
        if (!isWbahRecordBooked(call)) continue;
        const row = buildBookedCallRow(call, workspaceId);
        const key = phoneDigits(row.phone) || row.dedup_key;
        const prev = byDigits.get(key);
        if (!prev || bookingRowScore(row) > bookingRowScore(prev)) {
          byDigits.set(key, row);
        }
      }
      if (batch.length < PAGE) break;
      from += PAGE;
    }

    const booked = [...byDigits.values()];
    if (!booked.length) return { rows: 0 };

    for (let i = 0; i < booked.length; i += 200) {
      const chunk = booked.slice(i, i + 200);
      const { error } = await (sb as any)
        .from("wbah_crm_contacts")
        .upsert(chunk, { onConflict: "workspace_id,dedup_key" });
      if (error) console.error("[wbah-booked-calls-sync] upsert error:", error.message);
    }

    _bookedCallsSyncAt = Date.now();
    console.log(`[wbah-booked-calls-sync] upserted=${booked.length} from wbah_calls`);
    return { rows: booked.length };
  })();

  try { return await _bookedCallsSyncInflight; }
  finally { _bookedCallsSyncInflight = null; }
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
  const refresh = async () => {
    await ensureFreshToken(sb);
    const t = await getStoredTokens(sb);
    if (!t) throw new Error("Re-login produced no token");
    return t.accessToken;
  };

  const sellersRes = await fetchAllLeadRecords(getTokens, refresh);
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
  const refresh = async () => {
    await ensureFreshToken(sb);
    const t = await getStoredTokens(sb);
    if (!t) throw new Error("Re-login produced no token");
    return t.accessToken;
  };

  const [sellersRes, buyersRes] = await Promise.allSettled([
    fetchAllLeadRecords(getTokens, refresh),
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
