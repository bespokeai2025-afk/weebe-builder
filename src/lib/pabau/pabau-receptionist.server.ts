/**
 * Pabau API for DNR medical receptionist (read + book appointments).
 * Auth: https://api.oauth.pabau.com/{api_key}/… — never send Bearer header.
 */
import {
  pabauFetch,
  pabauListItems,
  pabauRequestHeaders,
  resolvePabauApiBase,
  type PabauApiError,
} from "./pabau-api.shared";

export type { PabauApiError };

export interface PabauClientConfig {
  apiKey: string;
  baseUrl?: string | null;
}

export interface PabauCreateAppointmentInput {
  contact_id: number | string;
  service_id: number | string;
  practitioner_id?: number | string;
  start_date: string;
  start_time: string;
  notes?: string;
  [key: string]: unknown;
}

function cfg(config: PabauClientConfig) {
  const apiKey = config.apiKey.trim();
  const base = resolvePabauApiBase(apiKey, config.baseUrl);
  return { apiKey, base, headers: pabauRequestHeaders() };
}

export async function pabauListAppointments(config: PabauClientConfig): Promise<unknown[]> {
  const { base, headers } = cfg(config);
  const json = await pabauFetch(`${base}/appointments`, { headers }, "Pabau list appointments");
  return pabauListItems(json);
}

export async function pabauListLeads(config: PabauClientConfig): Promise<unknown[]> {
  const { base, headers } = cfg(config);
  const json = await pabauFetch(`${base}/leads`, { headers }, "Pabau list leads");
  return pabauListItems(json);
}

export async function pabauListServiceCategories(config: PabauClientConfig): Promise<unknown[]> {
  const { base, headers } = cfg(config);
  const json = await pabauFetch(`${base}/categories/services`, { headers }, "Pabau list service categories");
  return pabauListItems(json);
}

export async function pabauGetClient(config: PabauClientConfig, contactId: number | string): Promise<unknown> {
  const { base, headers } = cfg(config);
  return pabauFetch(`${base}/clients/${contactId}`, { headers }, `Pabau get client ${contactId}`);
}

export async function pabauCreateAppointment(
  config: PabauClientConfig,
  input: PabauCreateAppointmentInput,
): Promise<unknown> {
  const { base } = cfg(config);
  return pabauFetch(
    `${base}/appointments/create`,
    {
      method: "POST",
      headers: pabauRequestHeaders(true),
      body: JSON.stringify(input),
    },
    "Pabau create appointment",
  );
}

/** Probe endpoints used by the medical receptionist — returns first successful read. */
export async function pabauProbeReceptionistAccess(config: PabauClientConfig): Promise<{
  ok: boolean;
  probes: Array<{ endpoint: string; ok: boolean; detail: string }>;
}> {
  const { base, headers } = cfg(config);
  const endpoints = [
    { path: "/appointments", label: "Appointments (read)" },
    { path: "/leads", label: "Leads (read)" },
    { path: "/categories/services", label: "Services (read)" },
  ];
  const probes: Array<{ endpoint: string; ok: boolean; detail: string }> = [];

  for (const { path, label } of endpoints) {
    try {
      const json = await pabauFetch(`${base}${path}`, { headers }, `Pabau ${label}`);
      const count = pabauListItems(json).length;
      probes.push({
        endpoint: path,
        ok: true,
        detail: count > 0 ? `${count} row(s)` : "accessible (0 rows)",
      });
    } catch (e) {
      probes.push({
        endpoint: path,
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { ok: probes.some((p) => p.ok), probes };
}
