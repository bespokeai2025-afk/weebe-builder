/** Pabau oauth REST API — base URL + response helpers. */

export const DEFAULT_PABAU_API_BASE = "https://api.oauth.pabau.com";

export function normalizePabauApiKey(input: string): string {
  return input.replace(/^Bearer\s+/i, "").trim();
}

export function normalizePabauApiBase(input?: string | null): string {
  const raw = (input ?? DEFAULT_PABAU_API_BASE).trim();
  return raw.replace(/\/+$/, "");
}

/**
 * Resolve request base URL.
 * Pabau auth is the API key in the path — do NOT send Authorization: Bearer (403).
 */
export function resolvePabauApiBase(apiKey: string, baseUrlOverride?: string | null): string {
  const key = normalizePabauApiKey(apiKey);
  const override = (baseUrlOverride ?? "").trim();
  if (override) {
    if (override.includes("{api_key}")) {
      return normalizePabauApiBase(override.replace(/\{api_key\}/g, key));
    }
    return normalizePabauApiBase(override);
  }
  return `${DEFAULT_PABAU_API_BASE}/${key}`;
}

/** OAuth API rejects Bearer tokens — key-in-path only. */
export function pabauRequestHeaders(jsonBody = false): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (jsonBody) headers["Content-Type"] = "application/json";
  return headers;
}

export class PabauApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    label: string,
  ) {
    super(`${label} — HTTP ${status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
}

export async function pabauFetch(
  url: string,
  init: RequestInit,
  label: string,
): Promise<unknown> {
  const res = await fetch(url, init);
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new PabauApiError(res.status, text, label);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Normalize list responses — oauth API wraps rows in named arrays. */
export function pabauListItems(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object") return [];
  const o = json as Record<string, unknown>;
  for (const key of [
    "appointments",
    "leads",
    "clients",
    "service_categories",
    "services",
    "data",
    "items",
    "results",
  ]) {
    const val = o[key];
    if (Array.isArray(val)) return val;
  }
  return [];
}

function nestedObject(input: unknown): Record<string, unknown> | null {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}

/** Flatten appointment / lead row for connector preview. */
export function pabauSampleRecord(json: unknown, kind: "appointment" | "lead" = "appointment"): Record<string, unknown> | null {
  const items = pabauListItems(json);
  const first = items[0];
  if (!first || typeof first !== "object") return null;
  const rec = first as Record<string, unknown>;

  if (kind === "lead") {
    return {
      lead_id: rec.lead_id ?? rec.id,
      first_name: rec.first_name,
      last_name: rec.last_name,
      email: rec.email,
      mobile: rec.mobile,
      lead_status: rec.lead_status,
    };
  }

  const details = nestedObject(rec.details);
  const dates = nestedObject(rec.dates);
  const clientArr = Array.isArray(rec.client) ? rec.client[0] : null;
  const client = nestedObject(clientArr);
  const serviceArr = Array.isArray(rec.service) ? rec.service[0] : null;
  const service = nestedObject(serviceArr);

  return {
    appointment_id: details?.appointment_id ?? rec.appointment_id ?? rec.id,
    client_id: client?.id ?? client?.contact_id,
    customer_name: client?.customer_name ?? client?.name,
    email: client?.Email ?? client?.email,
    mobile: client?.Mobile ?? client?.mobile,
    service: service?.service,
    start_date: dates?.start_date,
    start_time: dates?.start_time,
  };
}
