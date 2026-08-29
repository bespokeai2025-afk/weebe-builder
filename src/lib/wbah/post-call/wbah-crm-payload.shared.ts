import type { AllensLogicResult } from "./wbah-allens-logic.shared";
import type { WbahFormattedCallData } from "./wbah-format-data.shared";
import { normalizeWbahAgenticCrmFields } from "./wbah-agentic-crm-normalize.shared";
import { mapWbahCallbackTypeToAgentPreference } from "./wbah-callback-dynamics.shared";
import { mapWbahVerifiedDetailsToDynamicsFields } from "./wbah-verified-details-dynamics.shared";

export type WbahCrmPatchPayload = Record<string, string | number | boolean | null>;

const NUMERIC_FIELD_PATTERN = /^(100000\d+|181510\d+|279640\d+)$/;

/** Explicit nulls Dynamics will accept to clear stale / garbage values. */
const CLEARABLE_DYNAMICS_FIELDS = new Set([
  "cos_callbackrequest",
  "new_propinfo_city",
  "new_propinfo_street2",
  "address1_city",
  "address1_line1",
]);

function isNumericOptionValue(v: unknown): v is string {
  return typeof v === "string" && NUMERIC_FIELD_PATTERN.test(v.trim());
}

/** Only include non-empty Dynamics fields (mirrors n8n getAllValidFields behaviour). */
export function filterValidDynamicsFields(fields: Record<string, unknown>): WbahCrmPatchPayload {
  const out: WbahCrmPatchPayload = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === null && CLEARABLE_DYNAMICS_FIELDS.has(key)) {
      out[key] = null;
      continue;
    }
    if (value == null || value === "") continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    if (typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value === "number") {
      out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) continue;
      out[key] = isNumericOptionValue(trimmed) ? Number(trimmed) : trimmed;
      continue;
    }
  }
  return out;
}

/** n8n node 34 — small agentic sentiment/status patch. */
export function buildWbahClearDataAgenticPayload(input: {
  statecode?: number | null;
  newCurrentstatus?: number | null;
  userSentiment?: string | null;
  callSummary?: string | null;
}): WbahCrmPatchPayload {
  const base: Record<string, unknown> = {};
  if (input.statecode != null) base.statecode = input.statecode;
  if (input.newCurrentstatus != null) base.new_currentstatus = input.newCurrentstatus;
  if (input.userSentiment) base.cos_user_sentiment = input.userSentiment;
  if (input.callSummary) base.cos_call_summary = input.callSummary;
  return filterValidDynamicsFields(base);
}

/** n8n node 15 — Build CRM Payload with Allen's skip flags + verified_details. */
export function buildWbahAllensCrmPayload(input: {
  formatted: WbahFormattedCallData;
  allens: AllensLogicResult;
  calendlyBookingUrl: string | null;
  callbackUtc: string | null;
  custom?: Record<string, unknown>;
  transcript?: string | null;
}): WbahCrmPatchPayload {
  const { formatted, allens, calendlyBookingUrl, callbackUtc, custom, transcript } = input;
  const payload: Record<string, unknown> = {};
  const vd = formatted.verifiedDetails ?? formatted.structuredJsonOutput ?? {};
  const slotBooked = Boolean(
    formatted.hasBookingSlot || formatted.appointmentConfirmed || formatted.appointmentDate,
  );

  if (!allens.skipStatusUpdate) {
    if (!allens.skipStatecodeUpdate && allens.statecodeOverride != null) {
      payload.statecode = allens.statecodeOverride;
    } else if (!allens.skipStatecodeUpdate) {
      payload.statecode = 0;
    }

    if (allens.newCurrentStatus != null) {
      payload.new_currentstatus = allens.newCurrentStatus;
    }

    if (allens.isCallbackRequest && callbackUtc) {
      payload.cos_callbackrequest = callbackUtc;
      const agentPreference = mapWbahCallbackTypeToAgentPreference({
        callbackType: formatted.callbackType,
        callbackHandler: formatted.callbackHandler,
        datetimeSource: formatted.callbackDatetimeSource,
      });
      if (agentPreference != null) payload.cr_agentpreference = agentPreference;
    }
  }

  if (slotBooked && !allens.isCallbackRequest) {
    if (formatted.requestedStartUtc) payload.cos_appointment_time = formatted.requestedStartUtc;
    if (formatted.appointmentDate) payload.cos_appointment_date = formatted.appointmentDate;
    if (calendlyBookingUrl) payload.cos_calendly_booking_url = calendlyBookingUrl;
    payload.cos_callbackrequest = null;
  } else if (!allens.skipAppointmentUpdate) {
    if (formatted.requestedStartUtc) payload.cos_appointment_time = formatted.requestedStartUtc;
    if (calendlyBookingUrl) payload.cos_calendly_booking_url = calendlyBookingUrl;
    if (formatted.appointmentDate) payload.cos_appointment_date = formatted.appointmentDate;
  }

  // Dynamics donotphone only when Allen's Logic detected an explicit remove/stop-contact request.
  if (allens.setDoNotPhone) {
    payload.donotphone = true;
  }

  const mapped = mapWbahVerifiedDetailsToDynamicsFields({
    verifiedDetails: vd,
    fallbackEmail: formatted.email,
    custom,
    transcript,
  });
  Object.assign(payload, mapped);

  if (formatted.userSentiment) payload.cos_user_sentiment = formatted.userSentiment;
  const vdSummary = typeof mapped.cos_call_summary === "string" ? mapped.cos_call_summary : null;
  if (vdSummary) payload.cos_call_summary = vdSummary;
  else if (formatted.callSummary) payload.cos_call_summary = formatted.callSummary;

  return filterValidDynamicsFields(payload);
}

/** Agentic PATCH from structured_json_output.verified_details */
export function buildWbahAgenticCrmPayload(
  structured: Record<string, unknown> | null,
  custom?: Record<string, unknown>,
  transcript?: string | null,
): WbahCrmPatchPayload {
  if (!structured) return {};
  const normalized = normalizeWbahAgenticCrmFields(structured, custom, transcript);
  return filterValidDynamicsFields(normalized);
}

/** n8n node 11 — append slot UTC to Calendly scheduling URL path. */
export function buildWbahCalendlySlotUrl(
  bookingUrl: string,
  formatted: WbahFormattedCallData,
): string {
  const requestedStart = formatted.requestedStartUtc;
  if (!bookingUrl || !requestedStart) return bookingUrl;

  try {
    const slotDateTime = new Date(requestedStart).toISOString();
    const slotDate = formatted.appointmentDate ?? slotDateTime.split("T")[0]!;
    const slotMonth = slotDate.slice(0, 7);
    const base = bookingUrl.replace(/\/$/, "");
    return `${base}/${encodeURIComponent(slotDateTime)}?month=${slotMonth}&date=${slotDate}`;
  } catch {
    return bookingUrl;
  }
}
