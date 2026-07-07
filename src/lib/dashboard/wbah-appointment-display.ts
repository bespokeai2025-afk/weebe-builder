import { normalizeSentiment } from "@/lib/sentiment";

const PARTIAL_QUALIFIED_MS = 5 * 60 * 1000;

type WbahLeadLike = {
  sentiment?: string | null;
  meta?: {
    partial_qualified?: boolean;
    duration_ms?: number | null;
    appointment_date?: string | null;
    appointment_time?: string | null;
    booking_status?: string | null;
    calendly_booking_url?: string | null;
  } | null;
};

/** WBAH-only: neutral calls >5min (or explicit meta flag). */
export function isWbahPartialQualified(lead: WbahLeadLike): boolean {
  if (lead.meta?.partial_qualified) return true;
  if (normalizeSentiment(lead.sentiment) !== "neutral") return false;
  const ms = lead.meta?.duration_ms;
  return ms != null && ms > PARTIAL_QUALIFIED_MS;
}

/**
 * Calendly / appointment fields are shown only for positive-sentiment contacts.
 * Partial-qualified rows never show appointment date/time (even if CRM has data).
 */
export function wbahAppointmentDate(lead: WbahLeadLike): string | null {
  if (isWbahPartialQualified(lead)) return null;
  if (normalizeSentiment(lead.sentiment) !== "positive") return null;
  const v = lead.meta?.appointment_date;
  return v != null && String(v).trim() !== "" ? String(v) : null;
}

export function wbahAppointmentTime(lead: WbahLeadLike): string | null {
  if (isWbahPartialQualified(lead)) return null;
  if (normalizeSentiment(lead.sentiment) !== "positive") return null;
  const v = lead.meta?.appointment_time;
  return v != null && String(v).trim() !== "" ? String(v) : null;
}

export function wbahBookingStatus(lead: WbahLeadLike): string | null {
  if (isWbahPartialQualified(lead)) return null;
  if (normalizeSentiment(lead.sentiment) !== "positive") return null;
  const v = lead.meta?.booking_status;
  return v != null && String(v).trim() !== "" ? String(v) : null;
}
