/**
 * POST /call-output-data/create body — n8n node #10 parity (dashboard analyzed branch).
 * Post-call result only — callback fields are sent in a separate POST (see wbah-callback-post.shared.ts).
 */
import { cleanWbahRawData } from "./wbah-format-data.shared";

export type WbahBuildSlotUrlOutput = {
  booking_url?: string;
  appointment_time?: string;
  appointment_date?: string;
  appointment_time_uk?: string;
  error?: string;
};

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
  const dyn = (call.retell_llm_dynamic_variables ?? {}) as Record<string, unknown>;

  const rawData = cleanWbahRawData(body as Record<string, unknown>);

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
    return {
      raw_data: rawData,
      lead_id: dyn.lead_id || '',
      user_sentiment: analysis.user_sentiment || '',
      call_successful: analysis.call_successful != null ? analysis.call_successful : null,
      call_summary: analysis.call_summary || '',
      calendly_booking_url: slot.booking_url || '',
      appointment_date: slot.appointment_date || '',
      appointment_time: slot.appointment_time || '',
      booking_status: 'success'
    };
  })())
}}`;
