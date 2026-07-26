import { normalizeSentiment } from "@/lib/sentiment";
import { WBAH_TIMEZONE } from "@/lib/dashboard/wbah-timezone";
import {
  confirmedCalendlyBookingUrl,
  isConfirmedCalendlyBooking,
  sanitizeWbahBookingFields,
} from "@/lib/dashboard/wbah-booking-meta";

export type WbahCallBookingFields = {
  event: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  booking_status: string | null;
  sentimentAnalysis: string | null;
  calendly_booking_url: string | null;
  call_summary: string | null;
  call_status: string | null;
};

export type WbahBookingUiState =
  | { kind: "pending"; label: string }
  | {
      kind: "booked";
      dateLabel: string;
      timeLabel: string;
      statusLabel: string;
      calendlyUrl: string | null;
      calendlyLabel: string;
    }
  | { kind: "positive_no_booking"; label: string; sentimentLabel: string }
  | {
      kind: "normal";
      dateLabel: string;
      timeLabel: string;
      statusLabel: string;
      sentimentLabel: string | null;
      calendlyUrl: string | null;
      calendlyLabel: string;
    };

function str(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (!s || /^n\/a$/i.test(s)) return null;
  return s;
}

/** Read booking fields from any WBAH call row shape (snake_case + camelCase). */
export function extractWbahCallBookingFields(
  row: Record<string, unknown> | null | undefined,
): WbahCallBookingFields {
  const r = row ?? {};
  const meta = (r.meta ?? r._rawCall ?? r._rawLead ?? {}) as Record<string, unknown>;
  const merged = { ...meta, ...r };

  return {
    event: str(
      merged.event ??
        merged.callEvent ??
        merged.retell_event ??
        merged.CallStatus ??
        merged.callStatus,
    ),
    appointment_date: str(
      merged.appointment_date ??
        merged.appointmentDate ??
        merged.AppointmentDate ??
        merged.call_appointment_date,
    ),
    appointment_time: str(
      merged.appointment_time ??
        merged.appointmentTime ??
        merged.AppointmentTime ??
        merged.call_appointment_time,
    ),
    booking_status: str(
      merged.booking_status ??
        merged.bookingStatus ??
        merged.BookingStatus ??
        merged.call_booking_status,
    ),
    sentimentAnalysis: str(
      merged.sentimentAnalysis ??
        merged.sentiment_analysis ??
        merged.sentiment ??
        merged.SentimentAnalysis,
    ),
    calendly_booking_url: str(
      merged.calendly_booking_url ??
        merged.calendlyBookingUrl ??
        merged.CalendlyBookingUrl ??
        merged.call_calendly_booking_url,
    ),
    call_summary: str(
      merged.call_summary ?? merged.callSummary ?? merged.CallSummary,
    ),
    call_status: str(
      merged.call_status ?? merged.callStatus ?? merged.CallStatus,
    ),
  };
}

/** Re-export — single source of truth for confirmed booking detection. */
export { isConfirmedCalendlyBooking };

function eventLower(fields: WbahCallBookingFields): string {
  return (fields.event ?? fields.call_status ?? "").toLowerCase();
}

/** Display-only booking fields — never infer from call_summary or slot URLs. */
export function resolveWbahCallBookingFields(
  row: Record<string, unknown> | null | undefined,
): WbahCallBookingFields {
  return sanitizeWbahBookingFields(extractWbahCallBookingFields(row));
}

/** Backend sends explicit N/A on TTC→DQ transfer calls — do not override. */
export function resolveWbahDisplaySentiment(
  row: Record<string, unknown> | null | undefined,
): string | null {
  const r = row ?? {};
  const rawSent =
    r.sentimentAnalysis ?? r.sentiment ?? r.sentiment_analysis ?? r.SentimentAnalysis;
  if (rawSent != null && /^n\/a$/i.test(String(rawSent).trim())) return "N/A";
  return str(rawSent);
}

/** True when Retell/WeeBespoke analysis has not landed yet (call_ended, no sentiment). */
export function isWbahCallAnalysisPending(fields: WbahCallBookingFields): boolean {
  if (isConfirmedCalendlyBooking(fields)) return false;

  const ev = eventLower(fields);
  if (ev === "call_analyzed" || ev === "analyzed") return false;
  if (ev === "call_started") return true;
  if (ev === "call_ended") return true;

  const sentiment = normalizeSentiment(fields.sentimentAnalysis);
  if (sentiment) return false;
  if (fields.call_summary?.trim()) return false;

  if (ev === "completed" || ev === "ended") return true;

  return false;
}

export function isWbahCallAnalysisComplete(fields: WbahCallBookingFields): boolean {
  return !isWbahCallAnalysisPending(fields);
}

export function formatWbahAppointmentDateDisplay(
  appointmentDate: string | null | undefined,
): string {
  const raw = str(appointmentDate);
  if (!raw) return "—";

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const iso = raw.length > 10 ? raw : `${raw}T12:00:00`;
    try {
      return new Date(iso).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: WBAH_TIMEZONE,
      });
    } catch {
      /* fall through */
    }
  }

  try {
    const parsed = Date.parse(raw);
    if (!isNaN(parsed)) {
      return new Date(parsed).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: WBAH_TIMEZONE,
      });
    }
  } catch {
    /* fall through */
  }

  return raw;
}

function parseTimePart(timePart: string): { hour: number; minute: number } | null {
  const raw = timePart.trim();
  const hm = raw.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]\.?M\.?))?$/i);
  if (hm) {
    let hour = Number(hm[1]);
    const minute = Number(hm[2]);
    const ampm = (hm[3] ?? "").toUpperCase();
    if (ampm.startsWith("P") && hour < 12) hour += 12;
    if (ampm.startsWith("A") && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return { hour, minute };
  }
  const amOnly = raw.match(/^(\d{1,2})\s*([AP]\.?M\.?)$/i);
  if (amOnly) {
    let hour = Number(amOnly[1]);
    const ampm = amOnly[2].toUpperCase();
    if (ampm.startsWith("P") && hour < 12) hour += 12;
    if (ampm.startsWith("A") && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23) return { hour, minute: 0 };
  }
  return null;
}

/** Format HH:mm as UK appointment wall-clock (not converted from viewer timezone). */
function formatUkWallClockTime(hour: number, minute: number): string {
  const d = new Date(Date.UTC(1970, 0, 1, hour, minute));
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  });
}

export function formatWbahAppointmentTimeDisplay(
  appointmentTime: string | null | undefined,
  appointmentDate?: string | null,
): string {
  const raw = str(appointmentTime);
  if (!raw) return "—";

  if (/T\d/.test(raw) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})/);
    if (m) {
      return `${formatWbahAppointmentDateDisplay(m[1])}, ${formatUkWallClockTime(Number(m[2]), Number(m[3]))}`;
    }
  }

  if (/T\d/.test(raw)) {
    try {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) {
        const datePart = formatWbahAppointmentDateDisplay(appointmentDate ?? raw);
        const timePart = d.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
          timeZone: WBAH_TIMEZONE,
        });
        return `${datePart}, ${timePart}`;
      }
    } catch {
      /* fall through */
    }
  }

  if (/^\d{1,2}:\d{2}/.test(raw)) {
    const t = parseTimePart(raw);
    if (t && appointmentDate) {
      return `${formatWbahAppointmentDateDisplay(appointmentDate)}, ${formatUkWallClockTime(t.hour, t.minute)}`;
    }
    if (t) {
      return formatUkWallClockTime(t.hour, t.minute);
    }
  }

  return raw;
}

export function formatWbahBookingStatusDisplay(
  bookingStatus: string | null | undefined,
): string {
  const raw = str(bookingStatus);
  if (!raw) return "—";
  return raw.replace(/_/g, " ");
}

/** Show Calendly link only for confirmed reschedulings/ URLs. */
export function resolveVisibleWbahCalendlyUrl(
  _bookingStatus: string | null | undefined,
  url: string | null | undefined,
): string | null {
  return confirmedCalendlyBookingUrl({ calendly_booking_url: url });
}

export function resolveVisibleWbahCalendlyUrlFromFields(
  fields: WbahCallBookingFields,
): string | null {
  return confirmedCalendlyBookingUrl(fields);
}

export function formatWbahCalendlyDisplay(
  _bookingStatus: string | null | undefined,
  url: string | null | undefined,
): string {
  if (resolveVisibleWbahCalendlyUrl(null, url)) {
    return "View Calendly booking";
  }
  return "—";
}

export function resolveWbahBookingUiState(
  row: Record<string, unknown> | null | undefined,
): WbahBookingUiState {
  const fields = resolveWbahCallBookingFields(row);

  if (isWbahCallAnalysisPending(fields)) {
    return { kind: "pending", label: "Call analysis pending…" };
  }

  const sentiment = normalizeSentiment(fields.sentimentAnalysis);
  const calendlyUrl = resolveVisibleWbahCalendlyUrlFromFields(fields);
  const calendlyLabel = calendlyUrl ? "View Calendly booking" : "—";

  if (isConfirmedCalendlyBooking(fields)) {
    return {
      kind: "booked",
      dateLabel: formatWbahAppointmentDateDisplay(fields.appointment_date),
      timeLabel: formatWbahAppointmentTimeDisplay(
        fields.appointment_time,
        fields.appointment_date,
      ),
      statusLabel: "success",
      calendlyUrl,
      calendlyLabel,
    };
  }

  if (sentiment === "positive") {
    return {
      kind: "positive_no_booking",
      label: "Positive call — no booking detected",
      sentimentLabel: fields.sentimentAnalysis ?? "Positive",
    };
  }

  return {
    kind: "normal",
    dateLabel: "—",
    timeLabel: "—",
    statusLabel: "—",
    sentimentLabel: fields.sentimentAnalysis,
    calendlyUrl: null,
    calendlyLabel: "—",
  };
}

export function wbahAppointmentDateCell(row: Record<string, unknown>): string {
  const ui = resolveWbahBookingUiState(row);
  if (ui.kind === "pending") return ui.label;
  if (ui.kind === "booked") return ui.dateLabel;
  return "—";
}

export function wbahAppointmentTimeCell(row: Record<string, unknown>): string {
  const ui = resolveWbahBookingUiState(row);
  if (ui.kind === "pending") return "—";
  if (ui.kind === "booked") return ui.timeLabel;
  return "—";
}

export function wbahBookingStatusCell(row: Record<string, unknown>): string {
  const ui = resolveWbahBookingUiState(row);
  if (ui.kind === "pending") return "—";
  if (ui.kind === "positive_no_booking") return "—";
  if (ui.kind === "booked") return ui.statusLabel;
  return "—";
}

export function wbahCalendlyCell(row: Record<string, unknown>): string {
  const fields = resolveWbahCallBookingFields(row);
  if (isWbahCallAnalysisPending(fields)) return "—";
  return formatWbahCalendlyDisplay(fields.booking_status, fields.calendly_booking_url);
}

export function wbahCallHistoryAppointmentCell(row: Record<string, unknown>): string {
  const fields = resolveWbahCallBookingFields(row);
  if (isWbahCallAnalysisPending(fields)) return "—";
  if (!isConfirmedCalendlyBooking(fields)) return "—";
  if (fields.appointment_date && fields.appointment_time) {
    return formatWbahAppointmentTimeDisplay(
      fields.appointment_time,
      fields.appointment_date,
    );
  }
  if (fields.appointment_date) {
    return formatWbahAppointmentDateDisplay(fields.appointment_date);
  }
  return "—";
}
