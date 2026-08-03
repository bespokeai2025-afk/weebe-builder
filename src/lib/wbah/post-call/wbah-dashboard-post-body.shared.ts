/**
 * POST /call-output-data/create body — n8n node #10 parity (dashboard analyzed branch).
 */
import { cleanWbahRawData } from "./wbah-format-data.shared";

export type WbahBuildSlotUrlOutput = {
  booking_url?: string;
  appointment_time?: string;
  appointment_date?: string;
  appointment_time_uk?: string;
  error?: string;
};

function normalizeCallbackDatetimeUtc(raw: string): string {
  if (!raw || raw === "NA") return "";
  try {
    if (/Z|[+-]\d{2}:?\d{2}$/.test(raw)) {
      return new Date(raw).toISOString();
    }
    const [datePart, timePart = "00:00:00"] = raw.split("T");
    const [y, m, day] = datePart.split("-").map(Number);
    const [hh, mm, ss = 0] = timePart.split(":").map(Number);
    const tmpUTC = new Date(Date.UTC(y, m - 1, day, hh, mm, ss));
    const ukFmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      timeZoneName: "shortOffset",
    });
    const parts = ukFmt.formatToParts(tmpUTC);
    const offPart = parts.find((p) => p.type === "timeZoneName")?.value || "GMT";
    const off = offPart.match(/GMT([+-]\d+)?/);
    const offHrs = off && off[1] ? Number(off[1]) : 0;
    return new Date(Date.UTC(y, m - 1, day, hh - offHrs, mm, ss)).toISOString();
  } catch {
    return raw.endsWith("Z") ? raw : `${raw}Z`;
  }
}

/**
 * Build WeeBespoke dashboard POST body (mirrors n8n POST TO DASHBOARD inline IIFE).
 * @param webhookItem — n8n item shape `{ body: { event, call } }` or flat trigger
 * @param slot — output from Build Slot URL node (`$('Build Slot URL').item.json`)
 */
export function buildWbahDashboardAnalyzedPostBody(
  webhookItem: Record<string, unknown>,
  slot: WbahBuildSlotUrlOutput = {},
): Record<string, unknown> {
  const body = (webhookItem.body ?? webhookItem) as Record<string, unknown>;
  const call = (body.call ?? {}) as Record<string, unknown>;
  const analysis = (call.call_analysis ?? {}) as Record<string, unknown>;
  const cad = (analysis.custom_analysis_data ?? {}) as Record<string, unknown>;
  const dyn = (call.retell_llm_dynamic_variables ?? {}) as Record<string, unknown>;

  const rawData = cleanWbahRawData(body as Record<string, unknown>);

  const cbDatetimeRaw = String(cad.callback_datetime ?? "");
  const cbType = String(cad.callback_type ?? "");
  const hasCallback = Boolean(cbDatetimeRaw && cbDatetimeRaw !== "" && cbDatetimeRaw !== "NA");
  const cbDatetimeUTC = hasCallback ? normalizeCallbackDatetimeUtc(cbDatetimeRaw) : "";

  const callSuccessfulRaw = analysis.call_successful;
  const callSuccessful =
    callSuccessfulRaw === true || callSuccessfulRaw === false
      ? callSuccessfulRaw
      : callSuccessfulRaw != null
        ? String(callSuccessfulRaw).toLowerCase() === "true"
        : null;

  return {
    raw_data: rawData,
    lead_id: String(dyn.lead_id ?? ""),
    user_sentiment: String(analysis.user_sentiment ?? ""),
    call_successful: callSuccessful,
    call_summary: String(analysis.call_summary ?? ""),
    calendly_booking_url: slot.booking_url ?? "",
    appointment_date: slot.appointment_date ?? "",
    appointment_time: slot.appointment_time ?? "",
    callback_datetime: cbDatetimeUTC,
    callback_datetime_raw: cbDatetimeRaw,
    callback_type: cbType,
    is_callback_request: hasCallback,
    booking_status: "success",
  };
}

/** n8n node #26 — POST TO DASHBOARD1 (call_started / call_ended lifecycle). */
export function buildWbahDashboardRawPostBody(
  webhookItem: Record<string, unknown>,
): Record<string, unknown> {
  const body = (webhookItem.body ?? webhookItem) as Record<string, unknown>;
  const call = (body.call ?? {}) as Record<string, unknown>;
  const dyn = (call.retell_llm_dynamic_variables ?? {}) as Record<string, unknown>;

  return {
    raw_data: cleanWbahRawData(body as Record<string, unknown>),
    lead_id: String(dyn.lead_id ?? ""),
    event: String(body.event ?? ""),
    calendly_booking_url: "",
    appointment_date: "",
    booking_status: "",
  };
}

export const WBAH_DASHBOARD_RAW_POST_BODY_TEMPLATE = `={{
  JSON.stringify({
    raw_data: $json.body,
    lead_id: $json.body.call.retell_llm_dynamic_variables.lead_id || '',
    event: $json.body.event || '',
    calendly_booking_url: '',
    appointment_date: '',
    booking_status: ''
  })
}}`;

/** n8n-style body template shown in the node editor (documentation / copy-paste). */
export const WBAH_DASHBOARD_ANALYZED_POST_BODY_TEMPLATE = `={{
  JSON.stringify((() => {
    const body = $json.body || {};
    const call = body.call || {};
    const analysis = call.call_analysis || {};
    const cad = analysis.custom_analysis_data || {};
    const dyn = call.retell_llm_dynamic_variables || {};
    const rawData = JSON.parse(JSON.stringify(body));
    delete rawData.available_slots;
    if (rawData.call) {
      delete rawData.call.transcript_with_tool_calls;
      delete rawData.call.transcript_object;
      delete rawData.call.latency;
      if (rawData.call.retell_llm_dynamic_variables) {
        delete rawData.call.retell_llm_dynamic_variables.available_slots;
      }
    }
    let slot = {};
    try { slot = $('Build Slot URL').item.json || {}; } catch(e) { slot = {}; }
    const cbDatetimeRaw = cad.callback_datetime || '';
    const cbType = cad.callback_type || '';
    const hasCallback = cbDatetimeRaw && cbDatetimeRaw !== '' && cbDatetimeRaw !== 'NA';
    let cbDatetimeUTC = '';
    if (hasCallback) {
      try {
        if (/Z|[+-]\\d{2}:?\\d{2}$/.test(cbDatetimeRaw)) {
          cbDatetimeUTC = new Date(cbDatetimeRaw).toISOString();
        } else {
          const [dp, tp = '00:00:00'] = cbDatetimeRaw.split('T');
          const [y, m, day] = dp.split('-').map(Number);
          const [hh, mm, ss = 0] = tp.split(':').map(Number);
          const tmpUTC = new Date(Date.UTC(y, m - 1, day, hh, mm, ss));
          const ukFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeZoneName: 'shortOffset' });
          const parts = ukFmt.formatToParts(tmpUTC);
          const offPart = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT';
          const off = offPart.match(/GMT([+-]\\d+)?/);
          const offHrs = off && off[1] ? Number(off[1]) : 0;
          cbDatetimeUTC = new Date(Date.UTC(y, m - 1, day, hh - offHrs, mm, ss)).toISOString();
        }
      } catch (e) {
        cbDatetimeUTC = cbDatetimeRaw.endsWith('Z') ? cbDatetimeRaw : cbDatetimeRaw + 'Z';
      }
    }
    return {
      raw_data: rawData,
      lead_id: dyn.lead_id || '',
      user_sentiment: analysis.user_sentiment || '',
      call_successful: analysis.call_successful != null ? analysis.call_successful : null,
      call_summary: analysis.call_summary || '',
      calendly_booking_url: slot.booking_url || '',
      appointment_date: slot.appointment_date || '',
      appointment_time: slot.appointment_time || '',
      callback_datetime: cbDatetimeUTC,
      callback_datetime_raw: cbDatetimeRaw,
      callback_type: cbType,
      is_callback_request: hasCallback ? true : false,
      booking_status: 'success'
    };
  })())
}}`;
