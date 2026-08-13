/**
 * Fetch Pabau locations and practitioners for DNR booking.
 */
import {
  pabauFetch,
  pabauListItems,
  pabauRequestHeaders,
  resolvePabauApiBase,
  type PabauClientConfig,
} from "@/lib/pabau/pabau-api.shared";
import {
  matchPractitionerByName,
  type PabauLocationRow,
  type PabauPractitionerRow,
} from "@/lib/pabau/pabau-location.shared";
import { DNR_VOICE } from "@/lib/dnr/dnr-voice.config";

function cfg(config: PabauClientConfig) {
  const apiKey = config.apiKey.trim();
  const base = resolvePabauApiBase(apiKey, config.baseUrl);
  return { base, headers: pabauRequestHeaders() };
}

function mapLocation(row: Record<string, unknown>): PabauLocationRow | null {
  const id = Number(row.id);
  if (!id) return null;
  const workingHours = Array.isArray(row.working_hours)
    ? (row.working_hours as PabauLocationRow["working_hours"])
    : undefined;
  const assigned = Array.isArray(row.assigned_employees)
    ? row.assigned_employees.map((x) => Number(x)).filter((n) => !Number.isNaN(n))
    : undefined;
  return {
    id,
    location_name: String(row.location_name ?? row.name ?? ""),
    working_hours: workingHours,
    assigned_employees: assigned,
  };
}

export async function pabauListLocations(config: PabauClientConfig): Promise<PabauLocationRow[]> {
  const { base, headers } = cfg(config);
  const json = await pabauFetch(`${base}/locations`, { headers }, "Pabau list locations");
  return pabauListItems(json)
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map(mapLocation)
    .filter((l): l is PabauLocationRow => !!l);
}

export async function pabauGetLocation(
  config: PabauClientConfig,
  locationId: number,
): Promise<PabauLocationRow | null> {
  const locations = await pabauListLocations(config);
  return locations.find((l) => l.id === locationId) ?? null;
}

export async function pabauListUsers(config: PabauClientConfig): Promise<PabauPractitionerRow[]> {
  const { base, headers } = cfg(config);
  const json = await pabauFetch(`${base}/users`, { headers }, "Pabau list users");
  return pabauListItems(json)
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      id: Number(r.id),
      full_name: String(r.full_name ?? r.username ?? ""),
      job_title: r.job_title ? String(r.job_title) : undefined,
    }))
    .filter((u) => u.id && u.full_name);
}

export async function pabauListPractitionersAtLocation(
  config: PabauClientConfig,
  locationId: number,
): Promise<PabauPractitionerRow[]> {
  const [location, users] = await Promise.all([
    pabauGetLocation(config, locationId),
    pabauListUsers(config),
  ]);
  if (!location?.assigned_employees?.length) return users.slice(0, 20);
  const allowed = new Set(location.assigned_employees);
  return users.filter((u) => allowed.has(u.id));
}

export function resolveDnrLocationId(input?: number | string | null): number {
  const n = Number(input);
  if (n && !Number.isNaN(n)) return n;
  return DNR_VOICE.pabau.locationId;
}

export async function resolveDnrPractitioner(
  config: PabauClientConfig,
  locationId: number,
  input?: { practitioner_id?: number | string; practitioner_name?: string },
): Promise<PabauPractitionerRow | null> {
  if (input?.practitioner_id != null && input.practitioner_id !== "") {
    const id = Number(input.practitioner_id);
    if (!Number.isNaN(id)) {
      const practitioners = await pabauListPractitionersAtLocation(config, locationId);
      return practitioners.find((p) => p.id === id) ?? { id, full_name: `Practitioner ${id}` };
    }
  }
  if (input?.practitioner_name?.trim()) {
    const practitioners = await pabauListPractitionersAtLocation(config, locationId);
    return matchPractitionerByName(practitioners, input.practitioner_name);
  }
  return null;
}

export function isDnrBookableLocation(locationId: number): boolean {
  return locationId === DNR_VOICE.pabau.locationId;
}

export function dnrLocationSummary(location: PabauLocationRow): string {
  return `${location.location_name} (location_id ${location.id})`;
}
