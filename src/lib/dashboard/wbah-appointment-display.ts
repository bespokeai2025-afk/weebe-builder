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

/** Extract an ISO-ish datetime from a Calendly booking URL path or query. */
function parseCalendlyUrlIso(url: string | null | undefined): string | null {
  if (!url || !String(url).trim()) return null;
  const raw = String(url);
  try {
    const decoded = decodeURIComponent(raw);
    const pathIso = decoded.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/i);
    if (pathIso) {
      let iso = pathIso[1];
      if (!/Z$/i.test(iso)) iso += "Z";
      const parsed = Date.parse(iso);
      if (!isNaN(parsed)) return new Date(parsed).toISOString();
    }
  } catch { /* malformed URI — fall through to query parse */ }
  const qDate = raw.match(/[?&]date=(\d{4}-\d{2}-\d{2})/i);
  if (qDate) {
    const parsed = new Date(`${qDate[1]}T09:00:00`);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

/** Parse 12-hour clock times like "03:30 PM". */
function parse12HourClock(t: string): { hour: number; minute: number } | null {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const ampm = m[3].toUpperCase();
  if (hour === 12) hour = ampm === "AM" ? 0 : 12;
  else if (ampm === "PM") hour += 12;
  return { hour, minute };
}

/** Parse WBAH appointment date + time strings into an ISO timestamp for the calendar. */
export function parseWbahAppointmentIso(
  appointmentDate: string | null | undefined,
  appointmentTime: string | null | undefined,
  calendlyUrl?: string | null,
): string | null {
  const dRaw = appointmentDate && String(appointmentDate).trim() ? String(appointmentDate).trim() : null;
  const tRaw = appointmentTime && String(appointmentTime).trim() ? String(appointmentTime).trim() : null;

  // Unix epoch (seconds or ms) in either field.
  for (const raw of [tRaw, dRaw]) {
    if (raw && /^\d{10,13}$/.test(raw)) {
      const n = Number(raw);
      const ms = n > 1e12 ? n : n * 1000;
      const parsed = new Date(ms);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }

  // Full ISO / RFC datetime in appointment_time (e.g. 2026-07-08T10:00:00.000Z from CRM).
  if (tRaw && /T\d{1,2}:\d{2}/.test(tRaw)) {
    const parsed = Date.parse(tRaw);
    if (!isNaN(parsed)) return new Date(parsed).toISOString();
  }

  // Full ISO in appointment_date alone.
  if (dRaw && /T\d{1,2}:\d{2}/.test(dRaw)) {
    const parsed = Date.parse(dRaw);
    if (!isNaN(parsed)) return new Date(parsed).toISOString();
  }

  if (dRaw) {
    const t = tRaw ?? "09:00";
    const clock12 = parse12HourClock(t);

    if (/^\d{4}-\d{2}-\d{2}/.test(dRaw)) {
      const datePart = dRaw.slice(0, 10);
      const isoHm = t.match(/T(\d{2}:\d{2})/);
      const hm = t.match(/^(\d{1,2}:\d{2})/);
      const timePart = isoHm?.[1] ?? hm?.[1] ?? "09:00";
      if (clock12) {
        const parsed = new Date(
          Number(datePart.slice(0, 4)),
          Number(datePart.slice(5, 7)) - 1,
          Number(datePart.slice(8, 10)),
          clock12.hour,
          clock12.minute,
        );
        if (!isNaN(parsed.getTime())) return parsed.toISOString();
      }
      const parsed = new Date(`${datePart}T${timePart}`);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }

    // DD/MM/YYYY or DD-MM-YYYY (UK)
    const slash = dRaw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (slash) {
      const [, a, b, year] = slash;
      const day = Number(a);
      const month = Number(b);
      const clock12uk = parse12HourClock(t);
      const isoHm = t.match(/T(\d{2}):(\d{2})/);
      const hm = t.match(/^(\d{1,2}):(\d{2})/);
      const hh = clock12uk ? clock12uk.hour : isoHm ? Number(isoHm[1]) : hm ? Number(hm[1]) : 9;
      const mm = clock12uk ? clock12uk.minute : isoHm ? Number(isoHm[2]) : hm ? Number(hm[2]) : 0;
      const parsed = new Date(Number(year), month - 1, day, hh, mm);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }

    const named = Date.parse(`${dRaw} ${t}`);
    if (!isNaN(named)) return new Date(named).toISOString();

    const loose = new Date(`${dRaw} ${t}`);
    if (!isNaN(loose.getTime())) return loose.toISOString();
  }

  // Time-only with ISO date embedded in appointment_time.
  if (tRaw && !dRaw) {
    const parsed = Date.parse(tRaw);
    if (!isNaN(parsed)) return new Date(parsed).toISOString();
  }

  const fromCalendly = parseCalendlyUrlIso(calendlyUrl);
  if (fromCalendly) return fromCalendly;

  // Never place calendar events on the call date — only explicit appointment data.
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

function formatWbahAppointmentTime(v: string): string {
  if (/T\d{2}:\d{2}/.test(v)) {
    try {
      return new Date(v).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    } catch { /* fall through */ }
  }
  return v;
}

function formatWbahAppointmentDate(v: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
    try {
      return new Date(v.length > 10 ? v : `${v}T12:00:00`).toLocaleDateString(undefined, {
        day: "2-digit", month: "short", year: "numeric",
      });
    } catch { /* fall through */ }
  }
  return v;
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
  const v = wbahAppointmentField(lead, "appointment_date");
  return v ? formatWbahAppointmentDate(v) : null;
}

export function wbahAppointmentTime(lead: WbahLeadLike): string | null {
  const v = wbahAppointmentField(lead, "appointment_time");
  return v ? formatWbahAppointmentTime(v) : null;
}

export function wbahBookingStatus(lead: WbahLeadLike): string | null {
  return wbahAppointmentField(lead, "booking_status");
}

/** Calendly booking URL — same visibility rules as other appointment columns. */
export function wbahCalendlyBookingUrl(lead: WbahLeadLike): string | null {
  if (isWbahPartialQualified(lead)) return null;
  const url = lead.meta?.calendly_booking_url;
  if (url == null || String(url).trim() === "") return null;
  if (normalizeSentiment(lead.sentiment) === "positive") return String(url).trim();
  if (hasWbahAppointmentBooked(lead)) return String(url).trim();
  return null;
}
