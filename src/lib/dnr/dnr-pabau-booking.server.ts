/**
 * DNR booking logic — Pabau services, clients, availability, appointments.
 */
import {
  PabauApiError,
  pabauFetch,
  pabauListItems,
  pabauRequestHeaders,
  resolvePabauApiBase,
  type PabauClientConfig,
} from "@/lib/pabau/pabau-api.shared";
import { pabauCreateAppointment, pabauListAppointments } from "@/lib/pabau/pabau-receptionist.server";
import { pabauFindClientByPhone } from "@/lib/pabau/pabau-client-lookup.shared";
import {
  iterateYmdRange,
  normalizeAvailabilityRange,
  slotIsFutureInLondon,
} from "@/lib/dnr/dnr-london-dates.shared";
import {
  isDnrBookableLocation,
  pabauGetLocation,
  resolveDnrLocationId,
  resolveDnrPractitioner,
} from "@/lib/dnr/dnr-pabau-locations.server";
import {
  locationHoursForDate,
  minutesToHm,
  parsePabauAppointment,
  serviceDisabledAtLocation,
  type PabauLocationRow,
} from "@/lib/pabau/pabau-location.shared";
import { DNR_VOICE } from "./dnr-voice.config";

export interface PabauServiceRow {
  id: number;
  service_name: string;
  duration: string;
  category_name?: string;
  price?: string;
  disabled_locations?: string;
}

function cfg(config: PabauClientConfig) {
  const apiKey = config.apiKey.trim();
  const base = resolvePabauApiBase(apiKey, config.baseUrl);
  return { base, headers: pabauRequestHeaders() };
}

export async function pabauListServices(
  config: PabauClientConfig,
  locationId?: number,
): Promise<PabauServiceRow[]> {
  const { base, headers } = cfg(config);
  const json = await pabauFetch(`${base}/services`, { headers }, "Pabau list services");
  const locId = locationId ?? DNR_VOICE.pabau.locationId;
  const items = pabauListItems(json);
  return items
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      id: Number(r.id),
      service_name: String(r.service_name ?? r.name ?? ""),
      duration: String(r.duration ?? ""),
      category_name: r.category_name ? String(r.category_name) : undefined,
      price: r.price ? String(r.price) : undefined,
      disabled_locations: r.disabled_locations ? String(r.disabled_locations) : undefined,
    }))
    .filter(
      (s) =>
        s.id &&
        s.service_name &&
        !serviceDisabledAtLocation(s.disabled_locations, locId),
    );
}

export function matchPabauService(
  services: PabauServiceRow[],
  input: string,
): PabauServiceRow | null {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  const exact = services.find((s) => s.service_name.toLowerCase() === q);
  if (exact) return exact;
  const contains = services.filter(
    (s) => s.service_name.toLowerCase().includes(q) || q.includes(s.service_name.toLowerCase()),
  );
  if (contains.length === 1) return contains[0]!;
  return contains.sort((a, b) => a.service_name.length - b.service_name.length)[0] ?? null;
}

export interface PabauNewClientInput {
  first_name: string;
  last_name: string;
  mobile: string;
  email: string;
  gender: "Male" | "Female" | "Other";
  /** YYYY-MM-DD. Not collected on the phone — only set if the caller volunteers it. */
  dob?: string;
  preferred_language?: string;
  salutation?: string;
}

export async function pabauCreateClient(
  config: PabauClientConfig,
  input: PabauNewClientInput,
): Promise<{ contact_id?: number; raw: unknown }> {
  const { base } = cfg(config);
  const body: Record<string, unknown> = {
    first_name: input.first_name,
    last_name: input.last_name,
    mobile: input.mobile,
    email: input.email,
    gender: input.gender,
    salutation: input.salutation ?? "None",
    // Pabau expects the field; the receptionist no longer asks for it.
    preferred_language: input.preferred_language ?? "English",
  };
  if (input.dob) body.DOB = input.dob;
  const raw = await pabauFetch(
    `${base}/clients/create`,
    {
      method: "POST",
      headers: pabauRequestHeaders(true),
      body: JSON.stringify(body),
    },
    "Pabau create client",
  );
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const contactId =
    Number(o.contact_id ?? o.client_id ?? o.id) ||
    Number((o.client as Record<string, unknown> | undefined)?.id);
  return { contact_id: contactId || undefined, raw };
}

export { pabauFindClientByPhone } from "@/lib/pabau/pabau-client-lookup.shared";

function parseDurationMinutes(duration: string): number {
  const h = duration.match(/(\d+)\s*h/i);
  const m = duration.match(/(\d+)\s*m/i);
  const parts = duration.split(":").map(Number);
  if (parts.length >= 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
    return parts[0] * 60 + parts[1];
  }
  if (h) return parseInt(h[1], 10) * 60 + (m ? parseInt(m[1], 10) : 0);
  if (m) return parseInt(m[1], 10);
  return 30;
}

function buildBookedSlotSet(
  appointments: unknown[],
  locationId: number,
  practitionerId?: number,
): Set<string> {
  const booked = new Set<string>();
  for (const appt of appointments) {
    const parsed = parsePabauAppointment(appt);
    if (!parsed) continue;
    if (parsed.location_id != null && parsed.location_id !== locationId) continue;
    if (practitionerId != null && parsed.practitioner_id != null && parsed.practitioner_id !== practitionerId) {
      continue;
    }
    booked.add(parsed.slot_key);
  }
  return booked;
}

function generateLocationSlots(input: {
  location: PabauLocationRow;
  range: { start: string; end: string };
  durationMin: number;
  booked: Set<string>;
  maxSlots?: number;
}): Array<{ start_date: string; start_time: string; display: string }> {
  const slots: Array<{ start_date: string; start_time: string; display: string }> = [];
  const max = input.maxSlots ?? 12;
  const step = 30;

  for (const sd of iterateYmdRange(input.range.start, input.range.end)) {
    if (slots.length >= max) break;
    const hours = locationHoursForDate(input.location, sd);
    if (!hours || hours.closed) continue;

    for (let minute = hours.openMin; minute + input.durationMin <= hours.closeMin; minute += step) {
      const hour = Math.floor(minute / 60);
      const min = minute % 60;
      if (!slotIsFutureInLondon(sd, hour, min)) continue;
      const st = minutesToHm(minute);
      const key = `${sd}T${st}`;
      if (input.booked.has(key)) continue;
      slots.push({
        start_date: sd,
        start_time: st,
        display: `${sd} at ${st}`,
      });
      if (slots.length >= max) break;
    }
  }

  return slots;
}

export async function pabauCheckAvailability(args: {
  config: PabauClientConfig;
  serviceName: string;
  startDate: string;
  endDate: string;
  locationId?: number;
  practitionerId?: number;
  practitionerName?: string;
}): Promise<{
  slots: Array<{ start_date: string; start_time: string; display: string; practitioner_id?: number }>;
  summary: string;
  location: { id: number; name: string };
  practitioner?: { id: number; name: string };
  date_range_used: { start_date: string; end_date: string; adjusted: boolean };
}> {
  const locationId = resolveDnrLocationId(args.locationId);
  if (!isDnrBookableLocation(locationId)) {
    return {
      slots: [],
      summary: `This line only books ${DNR_VOICE.location.name}. Liverpool and London must be handled by the team.`,
      location: { id: locationId, name: "Unsupported location" },
      date_range_used: { start_date: args.startDate, end_date: args.endDate, adjusted: false },
    };
  }

  const [location, practitioner] = await Promise.all([
    pabauGetLocation(args.config, locationId),
    resolveDnrPractitioner(args.config, locationId, {
      practitioner_id: args.practitionerId,
      practitioner_name: args.practitionerName,
    }),
  ]);

  if (!location) {
    return {
      slots: [],
      summary: `Location ${locationId} not found in Pabau.`,
      location: { id: locationId, name: "Unknown" },
      date_range_used: { start_date: args.startDate, end_date: args.endDate, adjusted: false },
    };
  }

  const services = await pabauListServices(args.config, locationId);
  const service = matchPabauService(services, args.serviceName);
  if (!service) {
    return {
      slots: [],
      summary: `I couldn't find a service matching "${args.serviceName}" at ${location.location_name}. Call list_services for exact names.`,
      location: { id: location.id, name: location.location_name },
      practitioner: practitioner ? { id: practitioner.id, name: practitioner.full_name } : undefined,
      date_range_used: { start_date: args.startDate, end_date: args.endDate, adjusted: false },
    };
  }

  const range = normalizeAvailabilityRange(args.startDate, args.endDate);
  const durationMin = parseDurationMinutes(service.duration);
  const appointments = await pabauListAppointments(args.config);
  const booked = buildBookedSlotSet(
    appointments,
    locationId,
    practitioner?.id,
  );

  const rawSlots = generateLocationSlots({
    location,
    range,
    durationMin,
    booked,
  });

  const slots = rawSlots.map((s) => ({
    ...s,
    ...(practitioner ? { practitioner_id: practitioner.id } : {}),
  }));

  const practNote = practitioner ? ` with ${practitioner.full_name}` : "";
  const rangeNote = range.adjusted
    ? ` (searched ${range.start} to ${range.end} — past dates were adjusted)`
    : "";
  const summary =
    slots.length === 0
      ? `No slots at ${location.location_name}${practNote} between ${range.start} and ${range.end}. Try another date or transfer to front of house.${rangeNote}`
      : `Found ${slots.length} slot(s) for ${service.service_name} at ${location.location_name}${practNote}.${rangeNote}`;

  return {
    slots,
    summary,
    location: { id: location.id, name: location.location_name },
    practitioner: practitioner ? { id: practitioner.id, name: practitioner.full_name } : undefined,
    date_range_used: {
      start_date: range.start,
      end_date: range.end,
      adjusted: range.adjusted,
    },
  };
}

/** Pull Pabau's own `message` out of a JSON error body. */
function pabauMessageFrom(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
    return message || null;
  } catch {
    return null;
  }
}

export interface DnrBookingFailure {
  /** Spoken back to the caller by the agent, so it stays plain English. */
  message: string;
  /** Machine-readable cause for logs and for branching in the prompt. */
  reason: "no_shift" | "slot_taken" | "permission" | "pabau_rejected";
  /** What the agent should do next. */
  hint: string;
}

/**
 * Turn a Pabau refusal into something the receptionist can act on.
 *
 * The "no shift" case is the common one: check_availability builds slots from the
 * location's opening hours, but Pabau will only accept a booking inside the
 * assigned employee's rostered shift, and it exposes no shift/rota endpoint on
 * this API key. So a slot we offered in good faith can still be refused.
 */
export function describePabauBookingFailure(pabauMessage: string | null): DnrBookingFailure {
  const text = (pabauMessage ?? "").toLowerCase();

  // Pabau phrases the same underlying problem two ways: no shift at all, or a
  // shift that is not at this location. Both mean "nobody is rostered then".
  if (text.includes("no shift") || text.includes("rostered")) {
    return {
      reason: "no_shift",
      message:
        "That time isn't on the clinician's rota, so I can't hold it. Let me find you another time.",
      hint: "Call check_availability again for a different day, or a different practitioner_name. If the second attempt also fails, use transfer_to_foh.",
    };
  }

  if (text.includes("already") || text.includes("taken") || text.includes("booked")) {
    return {
      reason: "slot_taken",
      message: "That slot has just been taken. Let me offer you the next available time.",
      hint: "Call check_availability again and offer a different slot.",
    };
  }

  if (text.includes("not allowed") || text.includes("permission") || text.includes("unauthor")) {
    return {
      reason: "permission",
      message:
        "I can't complete the booking from here. Let me pass you to our front-of-house team to finish it.",
      hint: "Use transfer_to_foh — the Pabau API key is missing appointment write access.",
    };
  }

  return {
    reason: "pabau_rejected",
    message: pabauMessage
      ? `The booking system wouldn't accept that: ${pabauMessage}`
      : "The booking system wouldn't accept that time.",
    hint: "Offer an alternative slot from check_availability. After two failures, use transfer_to_foh.",
  };
}

/**
 * Appointment notes for a phone booking.
 *
 * Bookings always go into the AI Receptionist column, so a caller asking for a
 * specific clinician would otherwise lose that request silently. Recording it
 * here lets front of house move the appointment to the right column.
 */
export function buildDnrAppointmentNotes(
  notes: string | undefined,
  requestedPractitionerId?: number,
): string {
  const parts = [notes?.trim() || "Booked via WEBEE AI receptionist"];
  if (
    requestedPractitionerId != null &&
    Number.isFinite(requestedPractitionerId) &&
    requestedPractitionerId !== DNR_VOICE.pabau.bookingEmployeeId
  ) {
    parts.push(`Caller requested practitioner id ${requestedPractitionerId} — please reassign`);
  }
  return parts.join(" · ").slice(0, 500);
}

export async function pabauBookAppointment(args: {
  config: PabauClientConfig;
  contactId: number | string;
  serviceName: string;
  startDate: string;
  startTime: string;
  notes?: string;
  locationId?: number;
  practitionerId?: number;
}): Promise<{
  ok: boolean;
  message: string;
  raw: unknown;
  reason?: DnrBookingFailure["reason"];
  hint?: string;
}> {
  const locationId = resolveDnrLocationId(args.locationId);
  const services = await pabauListServices(args.config, locationId);
  const service = matchPabauService(services, args.serviceName);
  if (!service) {
    return { ok: false, message: `Unknown service: ${args.serviceName}`, raw: null };
  }

  const location = await pabauGetLocation(args.config, locationId);
  const body: Record<string, unknown> = {
    contact_id: args.contactId,
    customer_id: String(args.contactId),
    service_id: service.id,
    start_date: args.startDate,
    start_time: args.startTime.length === 5 ? `${args.startTime}:00` : args.startTime,
    location_id: locationId,
    notes: buildDnrAppointmentNotes(args.notes, args.practitionerId),
    // Always the AI Receptionist column — Pabau checks employee_id against that
    // user's rota, and it is the one the clinic maintains for phone bookings.
    // Pabau's create API wants employee_id here, not user_id / practitioner_id.
    employee_id: DNR_VOICE.pabau.bookingEmployeeId,
  };

  const locName = location?.location_name ?? DNR_VOICE.location.name;

  let raw: unknown;
  try {
    raw = await pabauCreateAppointment(args.config, body as never);
  } catch (e) {
    // A refused booking is a normal conversational outcome, not a crash: the
    // agent needs to hear why so it can offer another slot instead of dying.
    if (e instanceof PabauApiError) {
      const failure = describePabauBookingFailure(pabauMessageFrom(e.body));
      console.warn("[dnr-pabau] Pabau refused booking", {
        status: e.status,
        reason: failure.reason,
        body: e.body.slice(0, 300),
        attempted: { ...body },
      });
      return { ok: false, message: failure.message, hint: failure.hint, reason: failure.reason, raw: e.body };
    }
    throw e;
  }

  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (o.success === false) {
    const failure = describePabauBookingFailure(
      typeof o.message === "string" ? o.message : null,
    );
    return { ok: false, message: failure.message, hint: failure.hint, reason: failure.reason, raw };
  }

  return {
    ok: true,
    message: `Booked ${service.service_name} on ${args.startDate} at ${args.startTime} at ${locName}.`,
    raw,
  };
}

export { pabauListPractitionersAtLocation } from "@/lib/dnr/dnr-pabau-locations.server";
