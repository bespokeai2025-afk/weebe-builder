import { z } from "zod";
import { dnrScalarToString, dnrStripNulls } from "@/lib/dnr/dnr-args.shared";
import { normalizeDateOfBirth } from "@/lib/dnr/dnr-new-client-intake.shared";

const bookSchema = z.object({
  contact_id: z.union([z.string().min(1), z.number()]),
  service_name: z.string().min(1),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "start_date must be YYYY-MM-DD"),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, "start_time must be HH:MM"),
  notes: z.string().max(500).optional(),
});

export type DnrBookAppointmentInput = z.infer<typeof bookSchema>;

function pickString(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

export function dnrSplitIsoDatetime(input: string): { date?: string; time?: string } {
  const s = input.trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})/);
  if (!m) return {};
  const time = dnrCoerceTime(m[2] ?? "");
  return { date: m[1], time: time ?? undefined };
}

export function dnrCoerceTime(input: string): string | null {
  return normalizeTime(input);
}

export function dnrCoerceDate(input: string): string | null {
  return normalizeDate(input);
}

function normalizeTime(input: string): string | null {
  const s = input.trim();
  const hm = s.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?$/);
  if (hm) {
    const h = Number(hm[1]);
    const m = Number(hm[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }
  return null;
}

function normalizeDate(input: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) return input.trim();
  return normalizeDateOfBirth(input);
}

/** Normalize messy Retell / voice booking args. */
export function normalizeDnrBookAppointmentArgs(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  // Retell runs with tool_call_strict_mode, so the model emits every declared
  // property and sends `null` for the ones it has no value for. Treat those as
  // absent, otherwise `notes: null` fails an optional string field and the
  // caller gets a "required fields missing" error with nothing actually missing.
  const o = dnrStripNulls(raw as Record<string, unknown>);

  const slot = o.slot ?? o.selected_slot ?? o.appointment_slot;
  if (slot && typeof slot === "object") {
    const s = slot as Record<string, unknown>;
    if (!o.start_date && s.start_date) o.start_date = s.start_date;
    if (!o.start_time && s.start_time) o.start_time = s.start_time;
  }

  const contactId = o.contact_id ?? o.contactId ?? o.client_id ?? o.clientId ?? o.customer_id;
  if (typeof contactId === "number") o.contact_id = contactId;
  else {
    const asString = dnrScalarToString(contactId);
    if (asString) o.contact_id = asString;
  }

  const service =
    pickString(o, "service_name", "service", "treatment", "treatment_name") ??
    dnrScalarToString(o.service_name);
  if (service) o.service_name = service;

  const dateRaw = pickString(o, "appointment_date", "date", "booking_date");
  if (dateRaw && !o.start_date) {
    const d = normalizeDate(dateRaw);
    if (d) o.start_date = d;
  } else if (typeof o.start_date === "string") {
    const d = normalizeDate(o.start_date);
    if (d) o.start_date = d;
  }

  const timeRaw = pickString(o, "appointment_time", "time", "booking_time");
  if (timeRaw && !o.start_time) {
    const t = normalizeTime(timeRaw);
    if (t) o.start_time = t;
  } else if (typeof o.start_time === "string") {
    const t = normalizeTime(o.start_time);
    if (t) o.start_time = t;
  }

  if (!o.start_date || !o.start_time) {
    for (const isoKey of ["start", "datetime", "appointment_start", "start_datetime"]) {
      const iso = pickString(o, isoKey);
      if (!iso) continue;
      const split = dnrSplitIsoDatetime(iso);
      if (split.date && !o.start_date) o.start_date = split.date;
      if (split.time && !o.start_time) o.start_time = split.time;
    }
  }

  if (typeof o.notes === "string") o.notes = o.notes.trim().slice(0, 500);
  else if ("notes" in o) delete o.notes;

  return o;
}

export function parseDnrBookAppointment(
  args: unknown,
):
  | { ok: true; data: DnrBookAppointmentInput }
  | {
      ok: false;
      error: string;
      hint: string;
      missing?: string[];
      invalid?: string[];
      details?: string;
    } {
  const normalized = normalizeDnrBookAppointmentArgs(args);
  const parsed = bookSchema.safeParse(normalized);
  if (!parsed.success) {
    const missing: string[] = [];
    const invalid: string[] = [];
    if (normalized.contact_id == null || normalized.contact_id === "") missing.push("contact_id");
    if (!normalized.service_name) missing.push("service_name");
    if (!normalized.start_date) missing.push("start_date");
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(normalized.start_date))) invalid.push("start_date");
    if (!normalized.start_time) missing.push("start_time");
    else if (!/^\d{2}:\d{2}$/.test(String(normalized.start_time))) invalid.push("start_time");

    // Anything Zod rejected that the checks above did not classify — without this
    // a schema failure on an unexpected field returns empty missing/invalid lists
    // and the agent has no idea what to correct.
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      if (!path || missing.includes(path) || invalid.includes(path)) continue;
      invalid.push(path);
    }

    return {
      ok: false,
      error: "contact_id, service_name, start_date, start_time required",
      hint:
        "Call find_or_create_client first and use its contact_id. Use exact service_name from list_services. " +
        "Call check_availability before book_appointment and pass start_date as YYYY-MM-DD and start_time as HH:MM from a returned slot.",
      missing,
      invalid: invalid.length ? invalid : undefined,
      details: parsed.error.issues
        .map((i) => `${i.path.join(".") || "field"}: ${i.message}`)
        .join("; "),
    };
  }
  return { ok: true, data: parsed.data };
}

export function dnrBookAppointmentHint(): string {
  return "Required: contact_id (from find_or_create_client), service_name (exact Pabau name), start_date (YYYY-MM-DD), start_time (HH:MM from availability slot).";
}
