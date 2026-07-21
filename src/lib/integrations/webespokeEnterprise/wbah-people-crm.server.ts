/**
 * WBAH People category tabs — reads synced cohorts from UAT backend CRM_data.
 * Dynamics FetchXML sync runs on the backend; WEBEE only calls JWT/CRM APIs.
 */
import * as api from "./client.server";
import { phoneDigits, loadWbahCrmBookingByDigits, resolveWbahBookingFields } from "@/lib/dashboard/wbah-booking-meta";
import { mergeInferredWbahBookingFields } from "@/lib/dashboard/wbah-call-booking-display";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DYNAMICS_CATEGORY_LABELS, type DynamicsCategorySlug } from "./wbah-campaign-sync.types";
import { parseWbahCrmData, type WbahCrmData } from "./wbah-crm-data.types";

export type WbahPeopleCategoryRow = {
  id: string;
  external_lead_id: string | null;
  external_status_code: string | null;
  external_status_label: string;
  webee_category: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  postcode: string | null;
  property_type: string | null;
  meta: {
    raw_lead: Record<string, unknown>;
    raw_crm?: Record<string, unknown>;
    raw_call?: Record<string, unknown>;
    lead_status: string;
    crm?: WbahCrmData | null;
    appointment_date: string | null;
    booking_status: string | null;
    recording_url: string | null;
    crm_loaded_at: string | null;
  };
  last_synced_at: string;
  created_at: string;
};

export type WbahPeopleCrmCategory = {
  slug: string;
  label: string;
  leadStatus?: string;
  callbackOnly?: boolean;
};

type GetTokens = () => Promise<{ accessToken: string; refreshToken: string }>;
type SaveToken = (token: string) => Promise<void>;
type Relogin = () => Promise<{ accessToken: string } | null>;

type WbahCbs = {
  getTokens: GetTokens;
  saveNewAccessToken: SaveToken;
  reloginFn?: Relogin;
};

export const WBAH_PEOPLE_CRM_CATEGORIES: WbahPeopleCrmCategory[] = [
  { slug: "disqualified", label: DYNAMICS_CATEGORY_LABELS.disqualified, leadStatus: "Disqualified" },
  {
    slug: "tried_to_contact",
    label: DYNAMICS_CATEGORY_LABELS.tried_to_contact,
    leadStatus: "Tried To Contact",
  },
  {
    slug: "rebook_initial_consultation",
    label: DYNAMICS_CATEGORY_LABELS.rebook_initial_consultation,
    leadStatus: "Rebook Initial Consultation",
  },
  { slug: "callback_request", label: "Callback Request", callbackOnly: true },
];

function wbahCatSlug(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeWbahPeopleCategorySlug(category: string): string {
  const slug = wbahCatSlug(category);
  if (slug === "rebooking" || slug === "rebook") return "rebook_initial_consultation";
  if (slug === "call_back_request") return "callback_request";
  const byLabel = WBAH_PEOPLE_CRM_CATEGORIES.find((c) => wbahCatSlug(c.label) === slug);
  if (byLabel) return byLabel.slug;
  return slug;
}

function resolveCategory(category: string): WbahPeopleCrmCategory {
  const slug = normalizeWbahPeopleCategorySlug(category);
  const found = WBAH_PEOPLE_CRM_CATEGORIES.find(
    (c) => c.slug === slug || wbahCatSlug(c.label) === wbahCatSlug(category),
  );
  if (!found) throw new Error(`Unknown WBAH People category: ${category}`);
  return found;
}

function responseEnvelope(raw: unknown): Record<string, unknown> {
  const r = raw as Record<string, unknown> | unknown[] | null;
  if (!r || typeof r !== "object" || Array.isArray(r)) return {};
  const o = r as Record<string, unknown>;
  if (o.data && typeof o.data === "object" && !Array.isArray(o.data)) {
    return o.data as Record<string, unknown>;
  }
  return o;
}

function extractRecords(raw: unknown): Record<string, unknown>[] {
  const r = raw as Record<string, unknown> | unknown[] | null;
  if (Array.isArray(r)) return r as Record<string, unknown>[];
  if (!r || typeof r !== "object") return [];
  const o = r as Record<string, unknown>;
  if (Array.isArray(o.data)) return o.data as Record<string, unknown>[];
  const envelope = responseEnvelope(raw);
  for (const key of ["data", "records", "rows", "items", "result", "list"]) {
    const v = envelope[key];
    if (Array.isArray(v)) return v as Record<string, unknown>[];
  }
  return [];
}

function extractPagination(raw: unknown): {
  totalItems: number;
  currentPage: number;
  pageSize: number;
} | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const pag = (r.pagination ?? responseEnvelope(raw).pagination ?? r.meta ?? null) as
    | Record<string, unknown>
    | null;
  if (!pag || typeof pag !== "object") return null;
  const totalItems = pag.totalItems ?? pag.totalRecords ?? pag.total_count ?? pag.total;
  if (typeof totalItems !== "number" || totalItems < 0) return null;
  return {
    totalItems,
    currentPage: Number(pag.currentPage ?? pag.current_page ?? 1),
    pageSize: Number(pag.pageSize ?? pag.page_size ?? pag.limit ?? 50),
  };
}

function parseCrmApiResponse(res: api.ApiResponse<unknown>): {
  records: Record<string, unknown>[];
  pagination: ReturnType<typeof extractPagination>;
} {
  if (!res.ok) {
    throw new Error(res.error ?? `CRM API failed (HTTP ${res.status})`);
  }
  const body = res.data as Record<string, unknown> | null;
  if (!body) throw new Error("Empty CRM API response");
  if (body.result === false) {
    throw new Error(String(body.message ?? "CRM API returned an error"));
  }
  return {
    records: extractRecords(body),
    pagination: extractPagination(body),
  };
}

function pickStr(raw: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = raw[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

function recordMatchesCategory(raw: Record<string, unknown>, cat: WbahPeopleCrmCategory): boolean {
  if (cat.callbackOnly) {
    return raw.is_callback_pending === true && raw.callback_completed !== true;
  }
  const slug = pickStr(raw, "sync_category_slug", "syncCategorySlug", "category_slug");
  if (slug) {
    if (slug !== cat.slug) return false;
    const expiresRaw = raw.category_expires_at ?? raw.categoryExpiresAt;
    if (expiresRaw) {
      const expires = new Date(String(expiresRaw)).getTime();
      if (!Number.isNaN(expires) && expires <= Date.now()) return false;
    }
    return true;
  }
  if (cat.leadStatus) {
    const ls = pickStr(raw, "lead_status", "leadStatus");
    return ls != null && ls.toLowerCase() === cat.leadStatus.toLowerCase();
  }
  return false;
}

function buildCrmQuery(
  cat: WbahPeopleCrmCategory,
  page: number,
  pageSize: number,
  search?: string,
): string {
  const params = new URLSearchParams();
  params.set("currentPage", String(page));
  params.set("pageSize", String(pageSize));
  if (cat.callbackOnly) {
    params.set("isCallbackPending", "true");
  } else {
    params.set("sync_category_slug", cat.slug);
  }
  if (search?.trim()) {
    params.set("search", search.trim());
  }
  return `/crm-data/get-crm-data?${params}`;
}

function mapCrmRow(raw: Record<string, unknown>, categoryLabel: string): WbahPeopleCategoryRow {
  const phone = pickStr(raw, "mobile_number", "mobileNumber", "phone", "toNumber");
  const leadId = pickStr(raw, "lead_id", "leadId", "_id", "id", "unique_id");
  const loadedAt =
    pickStr(raw, "category_first_seen_at", "categoryFirstSeenAt", "first_seen", "firstSeen", "createdAt", "created_at", "synced_at") ??
    new Date().toISOString();
  const leadStatus = pickStr(raw, "lead_status", "leadStatus") ?? categoryLabel;
  const crm = parseWbahCrmData(raw);

  const rawLead: Record<string, unknown> = {
    callStatus: raw.callStatus ?? raw.call_status ?? null,
    sentimentAnalysis: raw.sentimentAnalysis ?? raw.sentiment_analysis ?? null,
    disconnectionReason: raw.disconnectionReason ?? raw.disconnection_reason ?? null,
    endReason: raw.endReason ?? raw.end_reason ?? null,
    appointment_date: raw.appointment_date ?? raw.appointmentDate ?? null,
    appointment_time: raw.appointment_time ?? raw.appointmentTime ?? null,
    booking_status: raw.booking_status ?? raw.bookingStatus ?? null,
    calendly_booking_url: raw.calendly_booking_url ?? raw.calendlyBookingUrl ?? null,
    agentName: raw.agentName ?? raw.agent_name ?? null,
    startTimestamp: raw.startTimestamp ?? raw.start_timestamp ?? null,
    durationMs: raw.durationMs ?? raw.duration_ms ?? null,
    recordingUrl: raw.recordingUrl ?? raw.recording_url ?? null,
    transcript: raw.transcript ?? null,
    is_callback_pending: raw.is_callback_pending ?? raw.isCallbackPending ?? null,
    category_slug: raw.category_slug ?? raw.categorySlug ?? null,
    need_to_call: crm?.need_to_call ?? raw.need_to_call ?? raw.needToCall ?? null,
    lead_status: leadStatus,
  };

  return {
    id: String(raw._id ?? raw.id ?? leadId ?? phone ?? `crm-${categoryLabel}-${Math.random().toString(36).slice(2)}`),
    external_lead_id: leadId ?? phone,
    external_status_code: leadStatus,
    external_status_label: categoryLabel,
    webee_category: categoryLabel,
    full_name: pickStr(raw, "name", "fullName", "full_name") ?? "Unknown",
    first_name: pickStr(raw, "first_name", "firstName", "firstname"),
    last_name: pickStr(raw, "last_name", "lastName", "lastname"),
    phone,
    email: pickStr(raw, "email", "emailAddress"),
    address: pickStr(raw, "address_line1", "address", "new_propinfo_street2"),
    city: pickStr(raw, "city", "new_propinfo_city"),
    postcode: pickStr(raw, "postal_code", "postcode", "new_propinfo_postalcode"),
    property_type: pickStr(raw, "property_type", "propertyType"),
    meta: {
      raw_lead: rawLead,
      raw_crm: { ...raw },
      raw_call: undefined,
      crm,
      lead_status: leadStatus,
      appointment_date: (rawLead.appointment_date as string | null) ?? null,
      booking_status: (rawLead.booking_status as string | null) ?? null,
      recording_url: (rawLead.recordingUrl as string | null) ?? null,
      crm_loaded_at: loadedAt,
    },
    last_synced_at: loadedAt,
    created_at: loadedAt,
  };
}

async function fetchCrmPage(
  cbs: WbahCbs,
  cat: WbahPeopleCrmCategory,
  page: number,
  pageSize: number,
  search?: string,
) {
  const path = buildCrmQuery(cat, page, pageSize, search);
  const res = await api.wbahGetCrmDataPath(path, cbs.getTokens, cbs.saveNewAccessToken, cbs.reloginFn);
  const { records: rawRecords, pagination } = parseCrmApiResponse(res);

  // Backend filters by sync_category_slug / isCallbackPending — trust pagination.totalItems.
  if (pagination) {
    return { records: rawRecords, total: pagination.totalItems };
  }

  // Legacy unfiltered bulk dump — filter client-side so tabs don't share one total.
  const records = rawRecords.filter((r) => recordMatchesCategory(r, cat));
  if (rawRecords.length > pageSize) {
    const start = (page - 1) * pageSize;
    return {
      records: records.slice(start, start + pageSize),
      total: records.length,
    };
  }
  return { records, total: records.length };
}

export async function listWbahCrmPeopleCategories(cbs: WbahCbs): Promise<{
  categories: { name: string; count: number }[];
  total: number;
}> {
  const base = api.getWebespokeApiBaseUrl();
  const counts = await Promise.all(
    WBAH_PEOPLE_CRM_CATEGORIES.map(async (cat) => {
      try {
        const { total } = await fetchCrmPage(cbs, cat, 1, 1);
        return { name: cat.label, count: total };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[wbah-people-crm] count failed for ${cat.slug}: ${msg}`);
        return { name: cat.label, count: 0, error: msg };
      }
    }),
  );
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  console.log(
    `[wbah-people-crm] api=${base} counts: ${counts.map((c) => `${c.name}=${c.count}`).join(", ")} (total=${total})`,
  );
  return { categories: counts, total   };
}

function mergeWbahCallIntoRawLead(
  raw: Record<string, unknown>,
  call: Record<string, unknown>,
): Record<string, unknown> {
  const startedMs = call.started_at ? new Date(String(call.started_at)).getTime() : null;
  const durationMs =
    call.duration_seconds != null ? Number(call.duration_seconds) * 1000 : null;
  const callMeta = (call.meta ?? {}) as Record<string, unknown>;
  const postCall =
    callMeta.custom_analysis && typeof callMeta.custom_analysis === "object"
      ? (callMeta.custom_analysis as Record<string, unknown>)
      : {};
  const dynamicVars =
    callMeta.dynamic_variables && typeof callMeta.dynamic_variables === "object"
      ? (callMeta.dynamic_variables as Record<string, unknown>)
      : {};
  return {
    ...raw,
    ...postCall,
    ...dynamicVars,
    callStatus: call.call_status ?? raw.callStatus ?? null,
    sentimentAnalysis: call.sentiment ?? raw.sentimentAnalysis ?? null,
    disconnectionReason: call.disconnection_reason ?? raw.disconnectionReason ?? null,
    endReason: call.end_reason ?? raw.endReason ?? null,
    appointment_date: call.appointment_date ?? raw.appointment_date ?? null,
    appointment_time: call.appointment_time ?? raw.appointment_time ?? null,
    booking_status: call.booking_status ?? raw.booking_status ?? null,
    calendly_booking_url: call.calendly_booking_url ?? raw.calendly_booking_url ?? null,
    agentName: call.agent_name ?? raw.agentName ?? null,
    startTimestamp:
      startedMs != null && !Number.isNaN(startedMs)
        ? String(startedMs)
        : (raw.startTimestamp ?? null),
    durationMs: durationMs != null ? String(durationMs) : (raw.durationMs ?? null),
    recordingUrl: call.recording_url ?? raw.recordingUrl ?? null,
    callSummary: call.call_summary ?? raw.callSummary ?? raw.call_summary ?? null,
    call_summary: call.call_summary ?? raw.call_summary ?? raw.callSummary ?? null,
    wbah_call_id: call.id ?? raw.wbah_call_id ?? null,
    has_transcript: !!(
      (call.transcript && String(call.transcript).trim()) ||
      call.recording_url ||
      raw.recordingUrl ||
      raw.has_transcript
    ),
  };
}

function applyBookingFieldsToRawLead(
  rawLead: Record<string, unknown>,
): Record<string, unknown> {
  const merged = mergeInferredWbahBookingFields({
    event: null,
    appointment_date: strOrNull(rawLead.appointment_date),
    appointment_time: strOrNull(rawLead.appointment_time),
    booking_status: strOrNull(rawLead.booking_status),
    sentimentAnalysis: strOrNull(rawLead.sentimentAnalysis),
    calendly_booking_url: strOrNull(rawLead.calendly_booking_url),
    call_summary: strOrNull(rawLead.callSummary ?? rawLead.call_summary),
    call_status: strOrNull(rawLead.callStatus),
  });
  return {
    ...rawLead,
    appointment_date: merged.appointment_date,
    appointment_time: merged.appointment_time,
    booking_status: merged.booking_status,
  };
}

function strOrNull(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  return s || null;
}

/** Overlay latest wbah_calls row per phone onto imported CRM cohort rows. */
export async function enrichPeopleCrmRowsWithWbahCalls(
  workspaceId: string,
  rows: WbahPeopleCategoryRow[],
): Promise<WbahPeopleCategoryRow[]> {
  if (!rows.length) return rows;
  const { getLatestWbahCallsForPhones } = await import("./wbah-leads.server");
  const [lookup, crmBookingByDigits] = await Promise.all([
    getLatestWbahCallsForPhones(
      workspaceId,
      rows.map((r) => r.phone),
    ),
    loadWbahCrmBookingByDigits(supabaseAdmin, workspaceId),
  ]);
  if (lookup.size === 0 && crmBookingByDigits.size === 0) return rows;

  return rows.map((row) => {
    const digits = phoneDigits(row.phone);
    const call =
      (digits ? lookup.get(digits) : undefined) ??
      lookup.get(String(row.phone ?? "").slice(-10));
    const crm = digits ? crmBookingByDigits.get(digits) ?? null : null;

    let rawLead = row.meta.raw_lead;
    if (call) {
      const appt = resolveWbahBookingFields(call, call, crm);
      rawLead = mergeWbahCallIntoRawLead(rawLead, { ...call, ...appt });
    } else if (crm) {
      rawLead = {
        ...rawLead,
        appointment_date: crm.appointment_date ?? rawLead.appointment_date ?? null,
        appointment_time: crm.appointment_time ?? rawLead.appointment_time ?? null,
        booking_status: crm.booking_status ?? rawLead.booking_status ?? null,
        calendly_booking_url:
          crm.calendly_booking_url ?? rawLead.calendly_booking_url ?? null,
        agentName: crm.agent_name ?? rawLead.agentName ?? null,
      };
    }

    rawLead = applyBookingFieldsToRawLead(rawLead);

    return {
      ...row,
      meta: {
        ...row.meta,
        raw_lead: rawLead,
        raw_call: call ? { ...call, ...resolveWbahBookingFields(call, call, crm) } : row.meta.raw_call,
        appointment_date: (rawLead.appointment_date as string | null) ?? row.meta.appointment_date,
        booking_status: (rawLead.booking_status as string | null) ?? row.meta.booking_status,
        recording_url: (rawLead.recordingUrl as string | null) ?? row.meta.recording_url,
      },
    };
  });
}

export async function listWbahCrmCategorizedLeads(
  cbs: WbahCbs,
  category: string,
  page: number,
  limit: number,
  search?: string,
): Promise<{
  rows: WbahPeopleCategoryRow[];
  total: number;
  page: number;
  limit: number;
  category: string;
}> {
  const cat = resolveCategory(category);
  const { records, total } = await fetchCrmPage(cbs, cat, page, limit, search);

  let rows = records.map((r) => mapCrmRow(r, cat.label));

  return {
    rows,
    total,
    page,
    limit,
    category: cat.slug,
  };
}

/** Admin probe: CRM_data counts per category (post-sync). */
export async function probeWbahCrmPeopleCategories(cbs: WbahCbs): Promise<{
  source: "crm_data";
  categories: Array<{
    slug: string;
    label: string;
    count: number;
    error?: string;
  }>;
}> {
  const categories = await Promise.all(
    WBAH_PEOPLE_CRM_CATEGORIES.map(async (cat) => {
      try {
        const { total } = await fetchCrmPage(cbs, cat, 1, 1);
        return { slug: cat.slug, label: cat.label, count: total };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { slug: cat.slug, label: cat.label, count: 0, error: msg };
      }
    }),
  );
  return { source: "crm_data", categories };
}

export function dynamicsSlugForLabel(label: string): DynamicsCategorySlug | null {
  const entry = Object.entries(DYNAMICS_CATEGORY_LABELS).find(([, l]) => l === label);
  return entry ? (entry[0] as DynamicsCategorySlug) : null;
}
