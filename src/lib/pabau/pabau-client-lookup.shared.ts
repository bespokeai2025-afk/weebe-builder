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

/** Same person's number, regardless of spacing, +44/0 prefix, or a couple of extra/missing digits. */
function phoneDigitsMatch(a: string, b: string): boolean {
  const da = a.replace(/\D/g, "");
  const db = b.replace(/\D/g, "");
  const n = Math.min(da.length, db.length, 10);
  if (n < 7) return false;
  return da.slice(-n) === db.slice(-n);
}

/**
 * Query one search variant and pick the caller's own record out of whatever comes back.
 *
 * This used to require exactly one row in the response (`total === 1` or `items.length === 1`)
 * before trusting it — reasonable-looking, but `search=` matches on name and email too, not just
 * the phone, and `mobile=` isn't guaranteed to be an exact filter either. A clinic's client list
 * commonly has more than one row share close-enough digits (family members, an old record kept
 * alongside a new one), and the strict count silently discarded a genuine match the moment a
 * second row appeared — which is indistinguishable, to the caller, from "you're not in the
 * system" even though they clearly are. Matching each row's own mobile against the number we
 * searched for is what actually establishes identity; the row count never did.
 */
async function searchClientsQuery(
  config: PabauClientConfig,
  param: "mobile" | "search",
  value: string,
  targetDigits: string,
): Promise<PabauClientMatch | null> {
  const { base, headers } = cfg(config);
  const url = `${base}/clients?${param}=${encodeURIComponent(value)}`;
  try {
    const json = await pabauFetch(url, { headers }, `Pabau search clients by ${param}`);
    const items = pabauListItems(json)
      .map(parsePabauClientRow)
      .filter((c): c is PabauClientMatch => !!c);
    if (items.length === 0) return null;

    const exact = items.find((c) => c.mobile && phoneDigitsMatch(c.mobile, targetDigits));
    if (exact) return exact;

    // No row's own mobile matched. If any row carried a mobile at all, that was a real,
    // checkable comparison that failed — trusting a different row now would be a guess, and a
    // wrong guess here means booking or updating a stranger's record. Only fall back to "the
    // only row" when nothing in the response had a mobile to check in the first place (some
    // Pabau rows omit `communications.mobile` entirely).
    const anyRowHadAMobile = items.some((c) => c.mobile);
    if (anyRowHadAMobile) return null;
    return items.length === 1 ? items[0]! : null;
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
  const targetDigits = phone.replace(/\D/g, "");
  const variants = pabauPhoneSearchVariants(phone);
  for (const variant of variants) {
    for (const param of ["mobile", "search"] as const) {
      const hit = await searchClientsQuery(config, param, variant, targetDigits);
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
