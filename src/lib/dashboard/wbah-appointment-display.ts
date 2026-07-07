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
    agent_name?: string | null;
  } | null;
};

function normBookingStatus(v: string | null | undefined): string {
  return String(v ?? "").toLowerCase().trim();
}

/** True when the contact has a Calendly / CRM appointment booked. */
export function hasWbahAppointmentBooked(lead: WbahLeadLike): boolean {
  const url = lead.meta?.calendly_booking_url;
  if (url != null && String(url).trim() !== "") return true;
  const bs = normBookingStatus(lead.meta?.booking_status);
  if (bs === "success" || bs === "booked" || bs === "confirmed") return true;
  const d = lead.meta?.appointment_date;
  return d != null && String(d).trim() !== "";
}

export function wbahBookingAgentName(lead: WbahLeadLike): string | null {
  const n = lead.meta?.agent_name;
  return n != null && String(n).trim() !== "" ? String(n).trim() : null;
}

/** Parse WBAH appointment date + time strings into an ISO timestamp for the calendar. */
export function parseWbahAppointmentIso(
  appointmentDate: string | null | undefined,
  appointmentTime: string | null | undefined,
): string | null {
  if (!appointmentDate || !String(appointmentDate).trim()) return null;
  const d = String(appointmentDate).trim();
  const t = appointmentTime && String(appointmentTime).trim() ? String(appointmentTime).trim() : "09:00";

  if (/^\d{4}-\d{2}-\d{2}/.test(d)) {
    const timePart = /^\d{1,2}:\d{2}/.test(t) ? t : "09:00";
    const parsed = new Date(`${d}T${timePart}`);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const slash = d.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slash) {
    const [, day, month, year] = slash;
    const tm = t.match(/^(\d{1,2}):(\d{2})/);
    const hh = tm ? Number(tm[1]) : 9;
    const mm = tm ? Number(tm[2]) : 0;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day), hh, mm);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const fallback = new Date(`${d} ${t}`);
  if (!isNaN(fallback.getTime())) return fallback.toISOString();
  return null;
}

export function wbahAppointmentStartIso(lead: WbahLeadLike): string | null {
  if (!hasWbahAppointmentBooked(lead)) return null;
  return parseWbahAppointmentIso(lead.meta?.appointment_date, lead.meta?.appointment_time);
}

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
