import { addMinutesIso, normalizeUkTime24, ukLocalToUtcIso } from "./wbah-uk-datetime.shared";

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
};

export type WbahFormattedCallData = {
  leadId: string | null;
  customerName: string | null;
  email: string | null;
  userSentiment: string | null;
  callSummary: string | null;
  callbackDatetime: string | null;
  callbackType: string | null;
  appointmentDate: string | null;
  appointmentTimeUk: string | null;
  requestedStartUtc: string | null;
  requestedEndUtc: string | null;
  updatedCalendlySlot: CalendlySlotShape | null;
  structuredJsonOutput: Record<string, unknown> | null;
  hasBookingSlot: boolean;
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
    pickStr(dyn, "full_name", "Full_name") ||
    [pickStr(dyn, "First_name", "first_name"), pickStr(dyn, "Last_name", "last_name")]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    null
  );
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

/** Port of n8n "Format Data" — UK slot → UTC ISO for Calendly + dashboard. */
export function formatWbahRetellCallData(input: WbahFormatDataInput): WbahFormattedCallData {
  const dyn = input.dynVars ?? {};
  const custom = input.custom ?? {};

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

  return {
    leadId,
    customerName: resolveName(dyn, custom),
    email: pickStr(custom, "email_address", "email") || pickStr(dyn, "email", "Email"),
    userSentiment: pickStr(custom, "user_sentiment") || null,
    callSummary: pickStr(custom, "call_summary") || null,
    callbackDatetime: pickStr(custom, "callback_datetime", "callback_date_time") || null,
    callbackType: pickStr(custom, "callback_type") || null,
    appointmentDate: slot?.date ?? null,
    appointmentTimeUk: timeUk,
    requestedStartUtc,
    requestedEndUtc,
    updatedCalendlySlot: slot
      ? { preferred_slot: { date: slot.date, time: timeUk ?? slot.time } }
      : calendlySlot,
    structuredJsonOutput: verified,
    hasBookingSlot: Boolean(requestedStartUtc),
  };
}

/** Strip heavy nested objects before POSTing raw_data to WeeBespoke. */
export function cleanWbahRawData(payload: Record<string, unknown>): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  const call = out.call as Record<string, unknown> | undefined;
  if (call && typeof call === "object") {
    delete call.transcript_object;
    delete call.transcript_with_tool_calls;
  }
  return out;
}
