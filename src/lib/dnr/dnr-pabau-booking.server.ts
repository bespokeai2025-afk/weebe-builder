/**
 * DNR booking logic — Pabau services, clients, availability, appointments.
 */
import {
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
  dayOfWeekLondon,
  normalizeAvailabilityRange,
  slotIsFutureInLondon,
} from "@/lib/dnr/dnr-london-dates.shared";
import { DNR_VOICE } from "./dnr-voice.config";

export interface PabauServiceRow {
  id: number;
  service_name: string;
  duration: string;
  category_name?: string;
  price?: string;
}

function cfg(config: PabauClientConfig) {
  const apiKey = config.apiKey.trim();
  const base = resolvePabauApiBase(apiKey, config.baseUrl);
  return { base, headers: pabauRequestHeaders() };
}

export async function pabauListServices(config: PabauClientConfig): Promise<PabauServiceRow[]> {
  const { base, headers } = cfg(config);
  const json = await pabauFetch(`${base}/services`, { headers }, "Pabau list services");
  const items = pabauListItems(json);
  return items
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      id: Number(r.id),
      service_name: String(r.service_name ?? r.name ?? ""),
      duration: String(r.duration ?? ""),
      category_name: r.category_name ? String(r.category_name) : undefined,
      price: r.price ? String(r.price) : undefined,
    }))
    .filter((s) => s.id && s.service_name);
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
  /** YYYY-MM-DD */
  dob: string;
  preferred_language?: string;
  how_did_you_hear_about_us?: string;
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
    DOB: input.dob,
    salutation: input.salutation ?? "None",
    preferred_language: input.preferred_language ?? "English",
  };
  if (input.how_did_you_hear_about_us?.trim()) {
    body.description = `How did you hear about us: ${input.how_did_you_hear_about_us.trim()}`;
  }
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

function apptStartIso(appt: unknown): string | null {
  if (!appt || typeof appt !== "object") return null;
  const a = appt as Record<string, unknown>;
  const dates = a.dates as Record<string, unknown> | undefined;
  const sd = dates?.start_date ?? a.start_date;
  const st = dates?.start_time ?? a.start_time;
  if (!sd || !st) return null;
  return `${String(sd).slice(0, 10)}T${String(st).slice(0, 8)}`;
}

export async function pabauCheckAvailability(args: {
  config: PabauClientConfig;
  serviceName: string;
  startDate: string;
  endDate: string;
}): Promise<{
  slots: Array<{ start_date: string; start_time: string; display: string }>;
  summary: string;
  date_range_used: { start_date: string; end_date: string; adjusted: boolean };
}> {
  const services = await pabauListServices(args.config);
  const service = matchPabauService(services, args.serviceName);
  if (!service) {
    return {
      slots: [],
      summary: `I couldn't find a service matching "${args.serviceName}". Please call list_services for exact names.`,
      date_range_used: { start_date: args.startDate, end_date: args.endDate, adjusted: false },
    };
  }

  const range = normalizeAvailabilityRange(args.startDate, args.endDate);
  const durationMin = parseDurationMinutes(service.duration);
  const appointments = await pabauListAppointments(args.config);
  const booked = new Set<string>();
  for (const appt of appointments) {
    const iso = apptStartIso(appt);
    if (iso) booked.add(iso.slice(0, 16));
  }

  const slots: Array<{ start_date: string; start_time: string; display: string }> = [];

  for (const sd of iterateYmdRange(range.start, range.end)) {
    if (slots.length >= 12) break;
    const day = dayOfWeekLondon(sd);
    if (day === 0) continue;
    const closeHour = day === 6 ? 19 : 20;
    for (let hour = 10; hour < closeHour; hour++) {
      for (const minute of [0, 30]) {
        if (hour === closeHour - 1 && minute + durationMin > 60) continue;
        if (!slotIsFutureInLondon(sd, hour, minute)) continue;
        const st = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        const key = `${sd}T${st}`;
        if (booked.has(key)) continue;
        slots.push({
          start_date: sd,
          start_time: st,
          display: `${sd} at ${st}`,
        });
        if (slots.length >= 12) break;
      }
      if (slots.length >= 12) break;
    }
  }

  const rangeNote = range.adjusted
    ? ` (searched ${range.start} to ${range.end} — past dates were adjusted to upcoming availability)`
    : "";
  const summary =
    slots.length === 0
      ? `No slots available between ${range.start} and ${range.end}. Try a wider range or transfer to front of house.${rangeNote}`
      : `Found ${slots.length} upcoming slot(s) for ${service.service_name} at ${DNR_VOICE.location.name}.${rangeNote}`;

  return {
    slots,
    summary,
    date_range_used: {
      start_date: range.start,
      end_date: range.end,
      adjusted: range.adjusted,
    },
  };
}

export async function pabauBookAppointment(args: {
  config: PabauClientConfig;
  contactId: number | string;
  serviceName: string;
  startDate: string;
  startTime: string;
  notes?: string;
}): Promise<{ ok: boolean; message: string; raw: unknown }> {
  const services = await pabauListServices(args.config);
  const service = matchPabauService(services, args.serviceName);
  if (!service) {
    return { ok: false, message: `Unknown service: ${args.serviceName}`, raw: null };
  }

  const body: Record<string, unknown> = {
    contact_id: args.contactId,
    service_id: service.id,
    start_date: args.startDate,
    start_time: args.startTime.length === 5 ? `${args.startTime}:00` : args.startTime,
    location_id: DNR_VOICE.pabau.locationId,
    notes: args.notes ?? "Booked via WEBEE AI receptionist",
  };

  const raw = await pabauCreateAppointment(args.config, body as never);
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ok = o.success !== false;
  return {
    ok,
    message: ok
      ? `Booked ${service.service_name} on ${args.startDate} at ${args.startTime} at Cheshire.`
      : String(o.message ?? "Booking failed"),
    raw,
  };
}
