import type { AllensLogicResult } from "./wbah-allens-logic.shared";
import type { WbahFormattedCallData } from "./wbah-format-data.shared";

export type WbahCrmPatchPayload = Record<string, string | number | boolean | null>;

const NUMERIC_FIELD_PATTERN = /^(100000\d+|181510\d+|279640\d+)$/;

function isNumericOptionValue(v: unknown): v is string {
  return typeof v === "string" && NUMERIC_FIELD_PATTERN.test(v.trim());
}

/** Only include non-empty Dynamics fields (mirrors n8n getAllValidFields behaviour). */
export function filterValidDynamicsFields(
  fields: Record<string, unknown>,
): WbahCrmPatchPayload {
  const out: WbahCrmPatchPayload = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === "") continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    if (typeof value === "boolean") {
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

export function buildWbahAllensCrmPayload(input: {
  formatted: WbahFormattedCallData;
  allens: AllensLogicResult;
  calendlyBookingUrl: string | null;
  callbackUtc: string | null;
}): WbahCrmPatchPayload {
  const { formatted, allens, calendlyBookingUrl, callbackUtc } = input;
  const base: Record<string, unknown> = {};

  if (allens.newCurrentStatus != null) {
    base.new_currentstatus = allens.newCurrentStatus;
  }
  if (calendlyBookingUrl) base.cos_calendly_booking_url = calendlyBookingUrl;
  if (formatted.appointmentDate) base.cos_appointment_date = formatted.appointmentDate;
  if (formatted.requestedStartUtc) base.cos_appointment_time = formatted.requestedStartUtc;
  if (callbackUtc) base.cos_callbackrequest = callbackUtc;
  if (formatted.userSentiment) base.cos_user_sentiment = formatted.userSentiment;
  if (formatted.callSummary) base.cos_call_summary = formatted.callSummary;

  return filterValidDynamicsFields(base);
}

/** Agentic PATCH from structured_json_output.verified_details */
export function buildWbahAgenticCrmPayload(
  structured: Record<string, unknown> | null,
): WbahCrmPatchPayload {
  if (!structured) return {};
  return filterValidDynamicsFields(structured);
}

/** Append slot deep-link query params to a Calendly scheduling URL. */
export function buildWbahCalendlySlotUrl(
  bookingUrl: string,
  formatted: WbahFormattedCallData,
): string {
  if (!formatted.appointmentDate || !formatted.appointmentTimeUk) return bookingUrl;
  try {
    const url = new URL(bookingUrl);
    url.searchParams.set("date", formatted.appointmentDate);
    url.searchParams.set("time", formatted.appointmentTimeUk);
    if (formatted.requestedStartUtc) {
      url.searchParams.set("start_time", formatted.requestedStartUtc);
    }
    if (formatted.requestedEndUtc) {
      url.searchParams.set("end_time", formatted.requestedEndUtc);
    }
    return url.toString();
  } catch {
    return bookingUrl;
  }
}
