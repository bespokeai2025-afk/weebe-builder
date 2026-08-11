import {
  pabauFetch,
  pabauListItems,
  pabauRequestHeaders,
  resolvePabauApiBase,
  type PabauClientConfig,
} from "@/lib/pabau/pabau-api.shared";

export type PabauClientMatch = { contact_id: number; name?: string; mobile?: string };

/** Build phone strings to try with Pabau /clients?mobile= and ?search= */
export function pabauPhoneSearchVariants(phone: string): string[] {
  const raw = phone.trim();
  const digits = raw.replace(/\D/g, "");
  const out = new Set<string>();
  if (raw) out.add(raw);
  if (digits) out.add(digits);

  if (digits.startsWith("44") && digits.length >= 11) {
    out.add(`0${digits.slice(2)}`);
    out.add(`+${digits}`);
    out.add(digits.slice(2));
  }
  if (digits.startsWith("0") && digits.length >= 10) {
    out.add(`+44${digits.slice(1)}`);
    out.add(`44${digits.slice(1)}`);
  }
  if (digits.length >= 7) out.add(digits.slice(-7));
  if (digits.length >= 9) out.add(digits.slice(-9));
  if (digits.length >= 10) out.add(digits.slice(-10));

  return [...out].filter(Boolean);
}

export function parsePabauClientRow(row: unknown): PabauClientMatch | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const details = (r.details ?? {}) as Record<string, unknown>;
  const comm = (r.communications ?? {}) as Record<string, unknown>;
  const contact_id = Number(details.id ?? r.id ?? r.contact_id ?? r.client_id);
  if (!contact_id) return null;
  const name = `${details.first_name ?? r.first_name ?? ""} ${details.last_name ?? r.last_name ?? ""}`.trim();
  const mobile = String(comm.mobile ?? comm.phone ?? r.mobile ?? r.phone ?? "").trim();
  return { contact_id, name: name || undefined, mobile: mobile || undefined };
}

function parsePabauLeadRow(row: unknown): PabauClientMatch | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const contact_id = Number(r.contact_id ?? r.customer_id ?? r.client_id ?? r.id);
  if (!contact_id) return null;
  const name = `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim();
  const mobile = String(r.mobile ?? r.phone ?? "").trim();
  return { contact_id, name: name || undefined, mobile: mobile || undefined };
}

function cfg(config: PabauClientConfig) {
  const apiKey = config.apiKey.trim();
  const base = resolvePabauApiBase(apiKey, config.baseUrl);
  return { base, headers: pabauRequestHeaders() };
}

async function searchClientsQuery(
  config: PabauClientConfig,
  param: "mobile" | "search",
  value: string,
): Promise<PabauClientMatch | null> {
  const { base, headers } = cfg(config);
  const url = `${base}/clients?${param}=${encodeURIComponent(value)}`;
  try {
    const json = await pabauFetch(url, { headers }, `Pabau search clients by ${param}`);
    const total = Number((json as Record<string, unknown>)?.total ?? 0);
    const items = pabauListItems(json);
    if (total === 1 && items.length >= 1) {
      return parsePabauClientRow(items[0]) ?? null;
    }
    if (items.length === 1) {
      return parsePabauClientRow(items[0]) ?? null;
    }
  } catch {
    /* try next variant */
  }
  return null;
}

/** Find an existing Pabau client by phone — uses /clients?mobile= not /leads. */
export async function pabauFindClientByPhone(
  config: PabauClientConfig,
  phone: string,
): Promise<PabauClientMatch | null> {
  const variants = pabauPhoneSearchVariants(phone);
  for (const variant of variants) {
    for (const param of ["mobile", "search"] as const) {
      const hit = await searchClientsQuery(config, param, variant);
      if (hit) return hit;
    }
  }

  // Fallback: scan leads (some records only exist as leads with contact_id set)
  const { base, headers } = cfg(config);
  try {
    const json = await pabauFetch(`${base}/leads`, { headers }, "Pabau list leads fallback");
    const needle = phone.replace(/\D/g, "").slice(-10);
    for (const row of pabauListItems(json)) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const mobile = String(r.mobile ?? r.phone ?? "").replace(/\D/g, "");
      if (needle.length >= 9 && mobile.slice(-10) === needle) {
        const parsed = parsePabauLeadRow(row);
        if (parsed) return parsed;
      }
    }
  } catch {
    /* non-fatal */
  }

  return null;
}
