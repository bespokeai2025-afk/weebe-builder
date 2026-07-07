import { normalizeSentiment } from "@/lib/sentiment";
import { isWbahRecordBooked } from "@/lib/dashboard/wbah-booking-meta";

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

/** True when the contact has a Calendly / CRM appointment booked. */
export function hasWbahAppointmentBooked(lead: WbahLeadLike): boolean {
  return isWbahRecordBooked(lead.meta ?? undefined);
}

export function wbahBookingAgentName(lead: WbahLeadLike): string | null {
  const n = lead.meta?.agent_name;
  return n != null && String(n).trim() !== "" ? String(n).trim() : null;
}

/** Parse WBAH appointment date + time strings into an ISO timestamp for the calendar. */
export function parseWbahAppointmentIso(
  appointmentDate: string | null | undefined,
  appointmentTime: string | null | undefined,
  fallbackIso?: string | null,
): string | null {
  if (!appointmentDate || !String(appointmentDate).trim()) {
    return fallbackIso && !isNaN(Date.parse(fallbackIso)) ? fallbackIso : null;
  }
  const d = String(appointmentDate).trim();
  const t = appointmentTime && String(appointmentTime).trim() ? String(appointmentTime).trim() : "09:00";

  // Full ISO / RFC datetime in appointment_date alone
  const direct = Date.parse(d);
  if (!isNaN(direct) && /[T\-\/]/.test(d) && d.length > 8) {
    return new Date(direct).toISOString();
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(d)) {
    const timePart = /^\d{1,2}:\d{2}/.test(t) ? t : "09:00";
    const parsed = new Date(`${d}T${timePart}`);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }

  // DD/MM/YYYY or DD-MM-YYYY (UK)
  const slash = d.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slash) {
    const [, a, b, year] = slash;
    const day = Number(a);
    const month = Number(b);
    const tm = t.match(/^(\d{1,2}):(\d{2})/);
    const hh = tm ? Number(tm[1]) : 9;
    const mm = tm ? Number(tm[2]) : 0;
    const parsed = new Date(Number(year), month - 1, day, hh, mm);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }

  // "6 January 2025" / "January 6, 2025"
  const named = Date.parse(`${d} ${t}`);
  if (!isNaN(named)) return new Date(named).toISOString();

  const fallback = new Date(`${d} ${t}`);
  if (!isNaN(fallback.getTime())) return fallback.toISOString();

  return fallbackIso && !isNaN(Date.parse(fallbackIso)) ? fallbackIso : null;
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
 * Appointment columns: hidden for partial-qualified only.
 * Shown whenever booking data exists (positive calls, or booked contacts whose
 * latest call is neutral/negative but CRM still carries the Calendly slot).
 */
function wbahAppointmentField(
  lead: WbahLeadLike,
  field: "appointment_date" | "appointment_time" | "booking_status",
): string | null {
  if (isWbahPartialQualified(lead)) return null;
  const v = lead.meta?.[field];
  if (v == null || String(v).trim() === "") return null;
  if (normalizeSentiment(lead.sentiment) === "positive") return String(v);
  if (hasWbahAppointmentBooked(lead)) return String(v);
  return null;
}

export function wbahAppointmentDate(lead: WbahLeadLike): string | null {
  return wbahAppointmentField(lead, "appointment_date");
}

export function wbahAppointmentTime(lead: WbahLeadLike): string | null {
  return wbahAppointmentField(lead, "appointment_time");
}

export function wbahBookingStatus(lead: WbahLeadLike): string | null {
  return wbahAppointmentField(lead, "booking_status");
}
