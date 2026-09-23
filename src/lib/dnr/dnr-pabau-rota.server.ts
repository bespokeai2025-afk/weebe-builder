/**
 * Who is actually rostered, from Pabau's /schedules endpoint.
 *
 * Availability used to be generated from the location's opening hours, so the agent offered times
 * nobody was working and Pabau refused the booking with "There is no shift for this timeslot" —
 * after the caller had already chosen it. An earlier comment in the booking module said Pabau
 * "exposes no shift/rota endpoint on this API key"; it does, and it takes `date`, `page` and
 * `per_page`.
 *
 * Two id fields travel on a shift and they are not interchangeable: `user_id` matches `/users.id`
 * (which is what the booking API accepts as `employee_id`), while `employee_id` is a separate
 * internal id that does not appear in `/users` at all. Only `user_id` is used here.
 */
import {
  pabauFetch,
  pabauRequestHeaders,
  resolvePabauApiBase,
} from "@/lib/pabau/pabau-api.shared";
// Defined in pabau-receptionist.server, not pabau-api.shared — the sibling DNR modules import it
// from the latter, which is why they each carry a pre-existing TS2305.
import type { PabauClientConfig } from "@/lib/pabau/pabau-receptionist.server";

export type PabauShift = {
  /** Matches /users.id — the value the appointment API wants as employee_id. */
  userId: number;
  userName: string;
  /** YYYY-MM-DD. */
  date: string;
  startMin: number;
  endMin: number;
  /** Null when the shift is not pinned to one location. */
  locationId: number | null;
  /** Empty when the shift covers every service. */
  serviceIds: number[];
  allServices: boolean;
};

function hmToMinutes(value: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  return h * 60 + min;
}

/** Pabau returns DD/MM/YYYY on schedules, unlike every other date it emits. */
export function pabauShiftDateToYmd(value: unknown): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value ?? "").trim());
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? "").trim());
  return iso ? iso[1]! : null;
}

export function parsePabauShift(row: Record<string, unknown>): PabauShift | null {
  const date = pabauShiftDateToYmd(row.shift_date);
  const startMin = hmToMinutes(row.start_time);
  const endMin = hmToMinutes(row.end_time);
  const userId = Number(row.user_id);
  if (!date || startMin == null || endMin == null || !userId) return null;
  if (endMin <= startMin) return null;
  // A holiday row is an absence, not a shift.
  if (Number(row.is_holiday ?? 0) === 1) return null;

  // "0" means the shift is not tied to a location rather than location zero.
  const rawLoc = Number(row.location ?? 0);
  const locationId = Number.isFinite(rawLoc) && rawLoc > 0 ? rawLoc : null;

  const serviceIds = Array.isArray(row.service_ids)
    ? row.service_ids.map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0)
    : [];

  return {
    userId,
    userName: String(row.user_name ?? "").trim(),
    date,
    startMin,
    endMin,
    locationId,
    serviceIds,
    allServices: Number(row.all_services ?? 0) === 1 || serviceIds.length === 0,
  };
}

/**
 * Shifts from `fromDate` onwards.
 *
 * `/schedules?date=` returns rows from that date, paginated; it ignores employee or location
 * filters, so the narrowing happens here.
 */
export async function pabauListShifts(
  config: PabauClientConfig,
  opts: { fromDate: string; maxPages?: number },
): Promise<PabauShift[]> {
  const apiKey = config.apiKey.trim();
  const base = resolvePabauApiBase(apiKey, config.baseUrl);
  const headers = pabauRequestHeaders();
  const maxPages = opts.maxPages ?? 4;

  const byId = new Map<string, PabauShift>();
  for (let page = 1; page <= maxPages; page++) {
    let json: unknown;
    try {
      json = await pabauFetch(
        `${base}/schedules?date=${encodeURIComponent(opts.fromDate)}&per_page=100&page=${page}`,
        { headers },
        "Pabau list schedules",
      );
    } catch {
      // Availability must still work if the rota cannot be read; the caller falls back to
      // opening hours rather than offering nothing at all.
      break;
    }
    const rows = (json as { schedules?: unknown[] } | null)?.schedules ?? [];
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const shift = parsePabauShift(raw as Record<string, unknown>);
      if (shift) byId.set(`${shift.userId}:${shift.date}:${shift.startMin}`, shift);
    }
    if (rows.length < 50) break;
  }
  return [...byId.values()];
}

/** Shifts covering a date at a location, including shifts not pinned to any location. */
export function shiftsForDateAtLocation(
  shifts: PabauShift[],
  date: string,
  locationId: number,
  serviceId?: number,
): PabauShift[] {
  return shifts
    .filter((s) => s.date === date)
    .filter((s) => s.locationId === null || s.locationId === locationId)
    .filter((s) => !serviceId || s.allServices || s.serviceIds.includes(serviceId))
    .sort((a, b) => a.startMin - b.startMin);
}

/**
 * Who should take a slot when several people are rostered.
 *
 * Prefers a generic column ("X Column Cheshire") over a named clinician: a phone booking is
 * triaged by front of house afterwards, and dropping it into a specific therapist's diary claims
 * their time on their behalf. A requested practitioner always wins.
 */
export function pickShiftForSlot(
  candidates: PabauShift[],
  startMin: number,
  durationMin: number,
  preferUserId?: number,
): PabauShift | null {
  const covering = candidates.filter(
    (s) => startMin >= s.startMin && startMin + durationMin <= s.endMin,
  );
  if (covering.length === 0) return null;
  if (preferUserId) {
    const wanted = covering.find((s) => s.userId === preferUserId);
    if (wanted) return wanted;
  }
  const generic = covering.find((s) => /^x\s*column/i.test(s.userName));
  return generic ?? covering[0]!;
}
