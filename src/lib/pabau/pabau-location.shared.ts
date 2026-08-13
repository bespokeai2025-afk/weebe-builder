/**
 * Pabau location + appointment metadata helpers (DNR booking).
 */
import { dayOfWeekLondon } from "@/lib/dnr/dnr-london-dates.shared";

export type PabauWorkingHoursRow = {
  day_name: string;
  opening_hours: string;
  closing_hours: string;
  closed: number | boolean;
};

export type PabauLocationRow = {
  id: number;
  location_name: string;
  working_hours?: PabauWorkingHoursRow[];
  assigned_employees?: number[];
};

export type PabauPractitionerRow = {
  id: number;
  full_name: string;
  job_title?: string;
};

export type ParsedPabauAppointment = {
  location_id?: number;
  practitioner_id?: number;
  practitioner_name?: string;
  start_date: string;
  start_time: string;
  slot_key: string;
};

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function weekdayNameLondon(ymd: string): string {
  return WEEKDAY_NAMES[dayOfWeekLondon(ymd)] ?? "Monday";
}

export function parseHmToMinutes(input: string): number | null {
  const m = input.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function minutesToHm(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function locationHoursForDate(
  location: PabauLocationRow,
  ymd: string,
): { openMin: number; closeMin: number; closed: boolean } | null {
  const dayName = weekdayNameLondon(ymd);
  const row = (location.working_hours ?? []).find(
    (h) => h.day_name?.toLowerCase() === dayName.toLowerCase(),
  );
  if (!row) return null;
  const closed = row.closed === 1 || row.closed === true;
  const openMin = parseHmToMinutes(row.opening_hours);
  const closeMin = parseHmToMinutes(row.closing_hours);
  if (openMin == null || closeMin == null) return null;
  return { openMin, closeMin, closed };
}

export function parsePabauAppointment(appt: unknown): ParsedPabauAppointment | null {
  if (!appt || typeof appt !== "object") return null;
  const a = appt as Record<string, unknown>;
  const details = (a.details ?? a) as Record<string, unknown>;
  const dates = (a.dates ?? {}) as Record<string, unknown>;
  const sd = String(dates.start_date ?? a.start_date ?? "").slice(0, 10);
  const stRaw = String(dates.start_time ?? a.start_time ?? "");
  const st = stRaw.slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sd) || !/^\d{2}:\d{2}$/.test(st)) return null;

  const loc = details.location as Record<string, unknown> | undefined;
  const pract = details.practitioner as Record<string, unknown> | undefined;
  const locationId = loc?.id != null ? Number(loc.id) : undefined;
  const practitionerId = pract?.practitioner_id != null ? Number(pract.practitioner_id) : undefined;
  const practitionerName =
    typeof pract?.practitioner_name === "string" ? pract.practitioner_name : undefined;

  return {
    location_id: locationId && !Number.isNaN(locationId) ? locationId : undefined,
    practitioner_id: practitionerId && !Number.isNaN(practitionerId) ? practitionerId : undefined,
    practitioner_name: practitionerName,
    start_date: sd,
    start_time: st,
    slot_key: `${sd}T${st}`,
  };
}

export function serviceDisabledAtLocation(
  disabledLocations: string | null | undefined,
  locationId: number,
): boolean {
  if (!disabledLocations?.trim()) return false;
  const ids = disabledLocations.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  return ids.includes(String(locationId));
}

export function matchPractitionerByName(
  practitioners: PabauPractitionerRow[],
  input: string,
): PabauPractitionerRow | null {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  const exact = practitioners.find((p) => p.full_name.toLowerCase() === q);
  if (exact) return exact;
  const partial = practitioners.filter(
    (p) => p.full_name.toLowerCase().includes(q) || q.includes(p.full_name.toLowerCase()),
  );
  if (partial.length === 1) return partial[0]!;
  return partial.sort((a, b) => a.full_name.length - b.full_name.length)[0] ?? null;
}
