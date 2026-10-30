/**
 * Data page — WBAH People rows: CRM category contacts and calls, in one shape.
 *
 * Category rows are built from the lead's stored CRM blobs (`meta.raw_lead`, `meta.raw_crm`,
 * `meta.raw_call`), whose keys vary by source (camelCase from WeeBespoke, snake_case from our
 * sync). Values are read as `unknown` and narrowed here, so the page works with typed rows.
 */
import {
  dqReasonLabel,
  isWbahLeadCallable,
  parseWbahCrmData,
  type WbahCrmData,
} from "@/lib/integrations/webespokeEnterprise/wbah-crm-data.types";
import {
  isTestLeadStatus,
  resolveWbahCrmPersonName,
} from "@/lib/integrations/webespokeEnterprise/wbah-campaign-sync.types";
import { sanitizeWbahBookingFields } from "@/lib/dashboard/wbah-booking-meta";

type Blob = Record<string, unknown>;

/** One row on a WBAH People tab (a CRM category contact, or a call on the Calls tab). */
export type WbahPeopleRow = {
  id: string;
  srNo: number;
  name: string | null;
  contact: string | null;
  phone?: string | null;
  email: string | null;
  callType: string | null;
  callStatus: string | null;
  sentimentAnalysis: string | null;
  disconnectionReason: string | null;
  appointmentDate: string | null;
  appointmentTime: string | null;
  bookingStatus: string | null;
  calendlyBookingUrl: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  booking_status: string | null;
  calendly_booking_url: string | null;
  agentName: string | null;
  startTimestamp: number | null;
  durationMs: number | null;
  recordingUrl: string | null;
  endReason: string | null;
  callSummary: string | null;
  hasTranscript: boolean;
  /** Calls rows and merged call detail use the snake_case names too. */
  agent_name?: string | null;
  sentiment?: string | null;
  // Category rows only
  leadStatus?: string | null;
  syncCategorySlug?: string | null;
  isTestLead?: boolean;
  needToCall?: boolean | null;
  isCallable?: boolean;
  dqReason?: string | null;
  dqReasonFull?: string | null;
  disqualifiedAt?: string | null;
  call_status?: string | null;
  transcript?: string | null;
  call_summary?: string | null;
  loadedAt?: string | null;
  wbahCallId?: string | null;
  _crm?: WbahCrmData | null;
  _rawCrm?: Blob | null;
  _rawCall?: Blob | null;
  _rawLead?: Blob;
};

/** A lead row from listWbahCategorizedLeads. */
export type WbahCategorySourceRow = {
  id: string;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
  external_status_label?: string | null;
  created_at?: string | null;
  callStatus?: unknown;
  sentimentAnalysis?: unknown;
  meta?: Blob | null;
};

function blob(v: unknown): Blob | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Blob) : null;
}

/** First value that is set, as a string (the page shows these as text). */
export function firstText(...values: unknown[]): string | null {
  return str(...values);
}

function str(...values: unknown[]): string | null {
  for (const v of values) if (v !== undefined && v !== null) return String(v);
  return null;
}

function numOrNull(v: unknown): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function mapWbahCatRow(r: WbahCategorySourceRow, idx: number): WbahPeopleRow {
  const meta = blob(r.meta) ?? {};
  const raw = blob(meta.raw_lead) ?? {};
  const rawCrm = blob(meta.raw_crm) ?? {};
  const rawCall = blob(meta.raw_call);
  const crm = (meta.crm as WbahCrmData | null | undefined) ?? parseWbahCrmData(blob(meta.raw_crm));
  const dqReasonShort = crm ? dqReasonLabel(crm) : null;
  const booking = sanitizeWbahBookingFields({
    appointment_date: str(meta.appointment_date, raw.appointment_date, rawCrm.call_appointment_date),
    appointment_time: str(raw.appointment_time, meta.appointment_time, rawCrm.call_appointment_time),
    booking_status: str(meta.booking_status, raw.booking_status, rawCrm.call_booking_status),
    calendly_booking_url: str(
      raw.calendly_booking_url,
      meta.calendly_booking_url,
      rawCrm.call_calendly_booking_url,
    ),
  });
  const leadStatusVal = str(crm?.lead_status, meta.lead_status, raw.lead_status);
  const syncCategorySlug =
    crm?.sync_category_slug ??
    str(raw.sync_category_slug) ??
    (typeof rawCrm.sync_category_slug === "string" ? rawCrm.sync_category_slug : null) ??
    (typeof rawCrm.syncCategorySlug === "string" ? rawCrm.syncCategorySlug : null) ??
    null;
  const displayName = resolveWbahCrmPersonName({
    ...rawCrm,
    ...raw,
    name: r.full_name,
    full_name: r.full_name,
    first_name: r.first_name ?? raw.first_name,
    last_name: r.last_name ?? raw.last_name,
  });
  const appointmentDate = booking.appointment_date ?? null;
  const appointmentTime = booking.appointment_time ?? null;
  const bookingStatus = booking.booking_status ?? null;
  const calendlyBookingUrl = booking.calendly_booking_url ?? null;
  return {
    id: r.id,
    srNo: idx + 1,
    name: displayName,
    contact: r.phone ?? null,
    email: str(r.email, raw.email, raw.emailAddress),
    callType: r.external_status_label ?? "Lead",
    callStatus: str(raw.callStatus),
    leadStatus: leadStatusVal,
    syncCategorySlug,
    isTestLead:
      isTestLeadStatus(leadStatusVal) ||
      isTestLeadStatus(r.external_status_label) ||
      isTestLeadStatus(str(raw.lead_status)),
    needToCall: crm?.need_to_call ?? null,
    isCallable: isWbahLeadCallable(crm),
    dqReason: dqReasonShort,
    dqReasonFull: crm?.disqualification_reason ?? null,
    disqualifiedAt: crm?.disqualified_at ?? null,
    disconnectionReason: str(raw.disconnectionReason),
    appointmentDate,
    appointmentTime,
    bookingStatus,
    calendlyBookingUrl,
    appointment_date: appointmentDate,
    appointment_time: appointmentTime,
    booking_status: bookingStatus,
    calendly_booking_url: calendlyBookingUrl,
    call_status: str(raw.callStatus, r.callStatus),
    sentimentAnalysis: str(raw.sentimentAnalysis, r.sentimentAnalysis),
    agentName: str(raw.agentName),
    startTimestamp: numOrNull(raw.startTimestamp),
    durationMs: numOrNull(raw.durationMs),
    recordingUrl: str(meta.recording_url, raw.recordingUrl),
    transcript: str(raw.transcript),
    callSummary: str(raw.callSummary, raw.call_summary, rawCall?.call_summary, rawCall?.callSummary),
    call_summary: str(raw.call_summary, raw.callSummary, rawCall?.call_summary),
    endReason: str(raw.endReason),
    loadedAt: str(meta.crm_loaded_at, r.created_at),
    wbahCallId: str(raw.wbah_call_id),
    hasTranscript: !!(raw.wbah_call_id || raw.has_transcript),
    _crm: crm,
    _rawCrm: blob(meta.raw_crm),
    _rawCall: rawCall,
    _rawLead: raw,
  };
}
