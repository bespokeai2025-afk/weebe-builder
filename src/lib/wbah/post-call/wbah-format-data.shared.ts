import {
  addMinutesIso,
  normalizeCallbackDatetimeUtc,
  normalizeUkTime24,
  ukLocalToUtcIso,
} from "./wbah-uk-datetime.shared";
import { resolveWbahCallbackFromAnalysis } from "./wbah-callback-dynamics.shared";
import { resolveWbahCallSummaryText } from "./wbah-timeline-note.shared";

export type CalendlySlotShape = {
  preferred_slot?: { date?: string; time?: string };
  date?: string;
  time?: string;
};

export type AvailableSlotsShape = {
  preferred_slot?: Array<{ date?: string; time?: string }>;
};

export type WbahFormatDataInput = {
  dynVars: Record<string, unknown>;
  custom: Record<string, unknown>;
  /** Retell top-level call_analysis — fallback for sentiment/summary not duplicated in custom. */
  callAnalysis?: Record<string, unknown> | null;
};

export type WbahFormattedCallData = {
  leadId: string | null;
  customerName: string | null;
  email: string | null;
  userSentiment: string | null;
  callSummary: string | null;
  callSuccessful: boolean | null;
  callbackDatetime: string | null;
  callbackDatetimeUtc: string | null;
  callbackType: string | null;
  callbackHandler: "human" | "ai" | null;
  callbackDatetimeSource:
    | "callback_datetime"
    | "human_callback_datetime"
    | "booking_callback_datetime"
    | null;
  humanCallbackDatetime: string | null;
  bookingCallbackDatetime: string | null;
  dynamicsAgentPreference: number | null;
  isCallbackRequest: boolean;
  appointmentDate: string | null;
  appointmentTimeUk: string | null;
  requestedStartUtc: string | null;
  requestedEndUtc: string | null;
  updatedCalendlySlot: CalendlySlotShape | null;
  structuredJsonOutput: Record<string, unknown> | null;
  verifiedDetails: Record<string, unknown> | null;
  hasBookingSlot: boolean;
  appointmentConfirmed: boolean;
};

function pickStr(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

function parseJsonField<T>(value: unknown): T | null {
  if (value == null || value === "") return null;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return null;
  }
}

function resolveName(dyn: Record<string, unknown>, custom: Record<string, unknown>): string | null {
  return (
    pickStr(custom, "customer_name", "full_name") ||
    pickStr(dyn, "full_name", "Full_name", "name") ||
    [pickStr(dyn, "First_name", "first_name"), pickStr(dyn, "Last_name", "last_name")]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    null
  );
}

export function resolveWbahCalendlySlot(
  calendlySlot: CalendlySlotShape | null,
  availableSlots: AvailableSlotsShape | null,
): { date: string; time: string } | null {
  return resolveSlot(calendlySlot, availableSlots);
}

/** n8n "Calendly Slot Not Empty" — calendly_slot or available_slots has a bookable slot. */
export function wbahWebhookHasCalendlySlot(webhookItem: Record<string, unknown>): boolean {
  const body = (webhookItem.body ?? webhookItem) as Record<string, unknown>;
  const call = (body.call ?? {}) as Record<string, unknown>;
  const custom = ((call.call_analysis as Record<string, unknown> | undefined)?.custom_analysis_data ??
    {}) as Record<string, unknown>;
  const dyn = (call.retell_llm_dynamic_variables ?? {}) as Record<string, unknown>;
  const calendlySlot = parseJsonField<CalendlySlotShape>(custom.calendly_slot);
  const availableSlots = parseJsonField<AvailableSlotsShape>(
    dyn.available_slots ?? custom.available_slots,
  );
  return resolveSlot(calendlySlot, availableSlots) != null;
}

function resolveSlot(
  calendlySlot: CalendlySlotShape | null,
  availableSlots: AvailableSlotsShape | null,
): { date: string; time: string } | null {
  const fromCalendly =
    calendlySlot?.preferred_slot?.date && calendlySlot?.preferred_slot?.time
      ? {
          date: calendlySlot.preferred_slot.date,
          time: calendlySlot.preferred_slot.time,
        }
      : calendlySlot?.date && calendlySlot?.time
        ? { date: calendlySlot.date, time: calendlySlot.time }
        : null;

  if (fromCalendly?.date && fromCalendly?.time) return fromCalendly;

  const fallback = availableSlots?.preferred_slot?.[0];
  if (fallback?.date && fallback?.time) {
    return { date: fallback.date, time: fallback.time };
  }

  return null;
}

export { normalizeCallbackDatetimeUtc } from "./wbah-uk-datetime.shared";

/** Port of n8n "Format Data" — UK slot → UTC ISO for Calendly + dashboard. */
export function formatWbahRetellCallData(input: WbahFormatDataInput): WbahFormattedCallData {
  const dyn = input.dynVars ?? {};
  const custom = input.custom ?? {};
  const analysis = input.callAnalysis ?? {};

  const leadId = pickStr(dyn, "lead_id", "leadId", "Lead_id");
  const calendlySlot = parseJsonField<CalendlySlotShape>(custom.calendly_slot);
  const availableSlots = parseJsonField<AvailableSlotsShape>(
    dyn.available_slots ?? custom.available_slots,
  );

  const slot = resolveSlot(calendlySlot, availableSlots);
  const timeUk = slot?.time ? normalizeUkTime24(slot.time) : null;
  const requestedStartUtc =
    slot?.date && timeUk ? ukLocalToUtcIso(slot.date, timeUk) : null;
  const requestedEndUtc = requestedStartUtc ? addMinutesIso(requestedStartUtc, 30) : null;

  const structured = parseJsonField<Record<string, unknown>>(custom.structured_json_output);
  const verified =
    structured && typeof structured.verified_details === "object"
      ? (structured.verified_details as Record<string, unknown>)
      : structured;

  const resolvedCallback = resolveWbahCallbackFromAnalysis(custom);
  const humanCallbackDatetime = pickStr(custom, "human_callback_datetime");
  const bookingCallbackDatetime = pickStr(
    custom,
    "booking_callback_datetime",
    "ai_callback_datetime",
  );

  const callSuccessfulRaw = analysis.call_successful ?? custom.call_successful;
  const callSuccessful =
    callSuccessfulRaw === true || callSuccessfulRaw === false
      ? callSuccessfulRaw
      : callSuccessfulRaw != null
        ? String(callSuccessfulRaw).toLowerCase() === "true"
        : null;

  const appointmentConfirmed =
    custom.appointment_confirmed === true ||
    custom.appointment_confirmed === "true" ||
    Boolean(slot?.date && timeUk);

  return {
    leadId,
    customerName: resolveName(dyn, custom),
    email: pickStr(custom, "email_address", "email") || pickStr(dyn, "email", "Email"),
    userSentiment: pickStr(custom, "user_sentiment") || pickStr(analysis, "user_sentiment") || null,
    callSummary: resolveWbahCallSummaryText(custom, analysis),
    callSuccessful,
    callbackDatetime: resolvedCallback.callbackDatetime,
    callbackDatetimeUtc: resolvedCallback.callbackDatetimeUtc,
    callbackType: resolvedCallback.callbackType,
    callbackHandler: resolvedCallback.callbackHandler,
    callbackDatetimeSource: resolvedCallback.datetimeSource,
    humanCallbackDatetime,
    bookingCallbackDatetime,
    dynamicsAgentPreference: resolvedCallback.dynamicsAgentPreference,
    isCallbackRequest: resolvedCallback.isCallbackRequest,
    appointmentDate: slot?.date ?? null,
    appointmentTimeUk: timeUk,
    requestedStartUtc,
    requestedEndUtc,
    updatedCalendlySlot: slot
      ? { preferred_slot: { date: slot.date, time: timeUk ?? slot.time } }
      : calendlySlot,
    structuredJsonOutput: verified,
    verifiedDetails: verified,
    hasBookingSlot: Boolean(requestedStartUtc),
    appointmentConfirmed,
  };
}

/** Strip heavy nested objects before POSTing raw_data to WeeBespoke (n8n parity). */
export function cleanWbahRawData(payload: Record<string, unknown>): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  delete out.available_slots;

  const call = out.call as Record<string, unknown> | undefined;
  if (call && typeof call === "object") {
    delete call.transcript_object;
    delete call.transcript_with_tool_calls;
    delete call.latency;
    const dyn = call.retell_llm_dynamic_variables as Record<string, unknown> | undefined;
    if (dyn && typeof dyn === "object") {
      delete dyn.available_slots;
    }
  }
  return out;
}
