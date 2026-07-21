import { normalizeSentiment } from "@/lib/sentiment";
import { WBAH_TIMEZONE } from "@/lib/dashboard/wbah-timezone";
import { isWbahBookingStatus } from "@/lib/dashboard/wbah-booking-meta";

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
      calendlyLabel: string;
    }
  | { kind: "positive_no_booking"; label: string; sentimentLabel: string }
  | {
      kind: "normal";
      dateLabel: string;
      timeLabel: string;
      statusLabel: string;
      sentimentLabel: string | null;
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

function eventLower(fields: WbahCallBookingFields): string {
  return (fields.event ?? fields.call_status ?? "").toLowerCase();
}

const BOOKED_SUMMARY_RE =
  /\b(?:appointment was successfully booked|successfully booked|appointment (?:has been )?booked|booking confirmed|that'?s all booked in|all booked in for you|got you down for|booked in for)\b/i;

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

/** Retell calls often only carry booking in call_summary — infer structured fields. */
export function inferWbahBookingFromCallSummary(
  summary: string | null | undefined,
): Pick<WbahCallBookingFields, "appointment_date" | "appointment_time" | "booking_status"> {
  const text = str(summary);
  if (!text || !BOOKED_SUMMARY_RE.test(text)) return {};

  const dtMatch =
    text.match(
      /(?:booked for|booked on|booked in for|scheduled for|down for|got you down for)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})(?:,?\s*(?:at\s+)?(\d{1,2}:\d{2}(?:\s*[AP]\.?M\.?)?|\d{1,2}\s*[AP]\.?M\.?))?/i,
    ) ??
    text.match(
      /([A-Za-z]+\s+\d{1,2},?\s+\d{4})(?:,?\s*(?:at\s+)?(\d{1,2}:\d{2}(?:\s*[AP]\.?M\.?)?|\d{1,2}\s*[AP]\.?M\.?))?/i,
    );

  if (!dtMatch?.[1]) return { booking_status: "success" };

  const parsed = Date.parse(dtMatch[1].replace(/,/g, ""));
  if (Number.isNaN(parsed)) return { booking_status: "success" };

  const appointment_date = new Date(parsed).toISOString().slice(0, 10);
  let appointment_time: string | null = null;
  if (dtMatch[2]) {
    const t = parseTimePart(dtMatch[2]);
    if (t) {
      // UK wall-clock time from call summary — never store naive ISO (browser TZ skews display).
      appointment_time = `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
    }
  }

  return { appointment_date, appointment_time, booking_status: "success" };
}

/** Merge DB/CRM fields with call_summary inference when structured booking is missing. */
export function mergeInferredWbahBookingFields(
  fields: WbahCallBookingFields,
): WbahCallBookingFields {
  if (fields.appointment_date && fields.booking_status) return fields;

  const inferred = inferWbahBookingFromCallSummary(fields.call_summary);
  if (!inferred.appointment_date && !inferred.booking_status) return fields;

  return {
    ...fields,
    appointment_date: fields.appointment_date ?? inferred.appointment_date ?? null,
    appointment_time: fields.appointment_time ?? inferred.appointment_time ?? null,
    booking_status: fields.booking_status ?? inferred.booking_status ?? null,
  };
}

export function resolveWbahCallBookingFields(
  row: Record<string, unknown> | null | undefined,
): WbahCallBookingFields {
  return mergeInferredWbahBookingFields(extractWbahCallBookingFields(row));
}

/** True when Retell/WeeBespoke analysis has not landed yet (call_ended, no booking/sentiment). */
export function isWbahCallAnalysisPending(fields: WbahCallBookingFields): boolean {
  if (fields.appointment_date || fields.booking_status) return false;

  const ev = eventLower(fields);
  if (ev === "call_analyzed" || ev === "analyzed") return false;
  if (ev === "call_started") return true;
  if (ev === "call_ended") return true;

  const sentiment = normalizeSentiment(fields.sentimentAnalysis);
  if (sentiment) return false;
  if (fields.call_summary?.trim()) return false;

  // DB normalizes ended/analyzed → "completed"; treat as pending until data arrives.
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

  // Naive ISO without timezone = UK wall clock (WeeBespoke/Retell appointment slots).
  if (/T\d/.test(raw) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})/);
    if (m) {
      return `${formatWbahAppointmentDateDisplay(m[1])}, ${formatUkWallClockTime(Number(m[2]), Number(m[3]))}`;
    }
  }

  // Full ISO datetime with timezone (e.g. 2026-07-24T10:00:00.000Z)
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

/** calendly_booking_url is redacted server-side — never show N/A as an error. */
export function formatWbahCalendlyDisplay(url: string | null | undefined): string {
  const raw = str(url);
  if (!raw) return "Booking link hidden";
  return raw;
}

function isWbahBookedFields(fields: WbahCallBookingFields): boolean {
  if (!fields.appointment_date) return false;
  const status = (fields.booking_status ?? "").toLowerCase();
  if (!status) return true;
  return status === "success" || isWbahBookingStatus(status);
}

export function resolveWbahBookingUiState(
  row: Record<string, unknown> | null | undefined,
): WbahBookingUiState {
  const fields = resolveWbahCallBookingFields(row);

  if (isWbahCallAnalysisPending(fields)) {
    return { kind: "pending", label: "Call analysis pending…" };
  }

  const status = (fields.booking_status ?? "").toLowerCase();
  const sentiment = normalizeSentiment(fields.sentimentAnalysis);
  const calendlyLabel = formatWbahCalendlyDisplay(fields.calendly_booking_url);

  if (isWbahBookedFields(fields)) {
    return {
      kind: "booked",
      dateLabel: formatWbahAppointmentDateDisplay(fields.appointment_date),
      timeLabel: formatWbahAppointmentTimeDisplay(
        fields.appointment_time,
        fields.appointment_date,
      ),
      statusLabel: formatWbahBookingStatusDisplay(fields.booking_status),
      calendlyLabel,
    };
  }

  if (sentiment === "positive" && !fields.appointment_date && status !== "success") {
    return {
      kind: "positive_no_booking",
      label: "Positive call — no booking detected",
      sentimentLabel: fields.sentimentAnalysis ?? "Positive",
    };
  }

  return {
    kind: "normal",
    dateLabel: fields.appointment_date
      ? formatWbahAppointmentDateDisplay(fields.appointment_date)
      : "—",
    timeLabel: fields.appointment_time
      ? formatWbahAppointmentTimeDisplay(fields.appointment_time, fields.appointment_date)
      : "—",
    statusLabel: fields.booking_status
      ? formatWbahBookingStatusDisplay(fields.booking_status)
      : "—",
    sentimentLabel: fields.sentimentAnalysis,
    calendlyLabel,
  };
}

/** Table cell: appointment date column. */
export function wbahAppointmentDateCell(row: Record<string, unknown>): string {
  const ui = resolveWbahBookingUiState(row);
  if (ui.kind === "pending") return ui.label;
  if (ui.kind === "positive_no_booking") return "—";
  if (ui.kind === "booked") return ui.dateLabel;
  return ui.dateLabel;
}

export function wbahAppointmentTimeCell(row: Record<string, unknown>): string {
  const ui = resolveWbahBookingUiState(row);
  if (ui.kind === "pending") return "—";
  if (ui.kind === "positive_no_booking") return "—";
  if (ui.kind === "booked") return ui.timeLabel;
  return ui.timeLabel;
}

export function wbahBookingStatusCell(row: Record<string, unknown>): string {
  const ui = resolveWbahBookingUiState(row);
  if (ui.kind === "pending") return "—";
  if (ui.kind === "positive_no_booking") return ui.label;
  if (ui.kind === "booked") return ui.statusLabel;
  return ui.statusLabel;
}

export function wbahCalendlyCell(row: Record<string, unknown>): string {
  const fields = resolveWbahCallBookingFields(row);
  if (isWbahCallAnalysisPending(fields)) return "—";
  return formatWbahCalendlyDisplay(fields.calendly_booking_url);
}
