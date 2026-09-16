/** UK address/postcode helpers for WBAH post-call CRM mapping. */

const UK_POSTCODE_CORE =
  /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i;

function isEmptyValue(v: unknown): boolean {
  return v == null || String(v).trim() === "";
}

/** Normalize to uppercase outward code + space, e.g. "m14 5pq" → "M14 5PQ". */
export function formatUkPostcode(raw: string): string | null {
  // Phonetic-alphabet dictation ("papa oscar one two two november golf" read
  // back and transcribed) often leaves stray punctuation around the letters
  // the LLM extracted (periods, hyphens, commas) — strip those too, not just
  // whitespace, so a correctly-heard postcode isn't rejected on formatting.
  const compact = raw.replace(/[\s.\-,]+/g, "").toUpperCase();
  const m = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
  if (!m) return null;
  return `${m[1]} ${m[2]}`;
}

export function looksLikeUkPostcode(raw: unknown): boolean {
  if (isEmptyValue(raw)) return false;
  const text = String(raw).trim();
  if (formatUkPostcode(text)) return true;
  return UK_POSTCODE_CORE.test(text);
}

/** Dynamics attributes that hold a postcode and must never take a garbled one. */
export const WBAH_POSTCODE_FIELDS: ReadonlySet<string> = new Set([
  "new_propinfo_postalcode",
  "address1_postalcode",
]);

/**
 * True when `value` is headed for a postcode attribute but does not parse as a
 * UK postcode.
 *
 * Dictated postcodes garble easily — "P R five six X Q" came back as "KR562"
 * on call_737e10b06ced477f741a1a31ec5 and overwrote the correct "PR5 6XQ"
 * that was already on the lead. A postcode is a lookup key for the rest of the
 * business, so a value that cannot be one is worse than no value at all:
 * writing it destroys good data and silently breaks every downstream match.
 * Callers skip the field so the CRM keeps whatever it already holds.
 */
export function rejectsAsUkPostcode(key: string, value: unknown): boolean {
  return WBAH_POSTCODE_FIELDS.has(key) && !looksLikeUkPostcode(value);
}

/** Free-text address attributes, where dictation drift looks like a real edit. */
const WBAH_ADDRESS_TEXT_FIELDS: ReadonlySet<string> = new Set([
  "new_propinfo_street2",
  "new_propinfo_street3",
  "new_propinfo_city",
  "new_propinfo_stateorprovince",
  "address1_line1",
  "address1_line2",
  "address1_city",
  "address1_stateorprovince",
  "address1_county",
]);

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length]!;
}

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const digits = (s: string) => s.replace(/\D/g, "");

/**
 * Drop address writes that look like the transcriber re-hearing an address the
 * CRM already holds, rather than the lead correcting it.
 *
 * On call_737e10b06ced477f741a1a31ec5 the lead's own web form had recorded
 * "Bamber Bridge"; the call wrote back "Bamba Bridge". Nothing about that value
 * is invalid, so no format check catches it — but the CRM's copy was typed by
 * the lead and the call's copy came through a phone line, and the second is not
 * better evidence than the first.
 *
 * Two conditions keep this from swallowing genuine corrections. The digits must
 * match, so "Flat 21" → "Flat 22" is always written through — numbers carry the
 * part of an address people actually correct. And the letters must be a near
 * match, so a move to an entirely different street is written through too. Only
 * the narrow middle — same numbers, almost the same letters — is treated as
 * noise and discarded.
 *
 * Returns the fields it removed, for the caller to log.
 */
export function preserveWbahAddressAgainstDictationDrift(
  patch: Record<string, unknown>,
  existing: Record<string, unknown> | null | undefined,
): string[] {
  if (!existing) return [];
  const dropped: string[] = [];

  for (const key of Object.keys(patch)) {
    if (!WBAH_ADDRESS_TEXT_FIELDS.has(key)) continue;
    const incoming = patch[key];
    const current = existing[key];
    if (isEmptyValue(incoming) || isEmptyValue(current)) continue;

    const a = String(incoming).trim();
    const b = String(current).trim();
    if (a.toLowerCase() === b.toLowerCase()) continue;
    if (digits(a) !== digits(b)) continue;

    const la = letters(a);
    const lb = letters(b);
    if (!la || !lb) continue;
    const distance = levenshtein(la, lb);
    const similarity = 1 - distance / Math.max(la.length, lb.length);
    if (similarity < 0.8) continue;

    delete patch[key];
    dropped.push(key);
  }

  return dropped;
}

type AddressFieldSet = {
  line1: string;
  line2?: string;
  city?: string;
  postcode?: string;
};

const PROPERTY_FIELDS: AddressFieldSet = {
  line1: "new_propinfo_street2",
  line2: "new_propinfo_street3",
  city: "new_propinfo_city",
  postcode: "new_propinfo_postalcode",
};

const CONTACT_FIELDS: AddressFieldSet = {
  line1: "address1_line1",
  line2: "address1_line2",
  city: "address1_city",
  postcode: "address1_postalcode",
};

function movePostcodeOutOfLine1(target: Record<string, unknown>, fields: AddressFieldSet): void {
  const line1Raw = target[fields.line1];
  if (isEmptyValue(line1Raw) || !looksLikeUkPostcode(line1Raw)) return;

  const formatted = formatUkPostcode(String(line1Raw).trim()) ?? String(line1Raw).trim().toUpperCase();
  const existingPostcode = isEmptyValue(target[fields.postcode!])
    ? null
    : formatUkPostcode(String(target[fields.postcode!]).trim()) ??
      String(target[fields.postcode!]).trim().toUpperCase();

  if (!existingPostcode || existingPostcode.replace(/\s/g, "") === formatted.replace(/\s/g, "")) {
    target[fields.postcode!] = formatted;
    target[fields.line1] = "";

    const line2 = target[fields.line2!];
    if (!isEmptyValue(line2) && !looksLikeUkPostcode(line2)) {
      target[fields.line1] = String(line2).trim();
      target[fields.line2!] = "";
    }
  }
}

function movePostcodeOutOfField(
  target: Record<string, unknown>,
  fieldKey: string | undefined,
  postcodeKey: string,
): void {
  if (!fieldKey) return;
  const raw = target[fieldKey];
  if (isEmptyValue(raw) || !looksLikeUkPostcode(raw)) return;

  const formatted = formatUkPostcode(String(raw).trim()) ?? String(raw).trim().toUpperCase();
  const existingPostcode = isEmptyValue(target[postcodeKey])
    ? null
    : formatUkPostcode(String(target[postcodeKey]).trim()) ??
      String(target[postcodeKey]).trim().toUpperCase();

  if (!existingPostcode || existingPostcode.replace(/\s/g, "") === formatted.replace(/\s/g, "")) {
    target[postcodeKey] = formatted;
    target[fieldKey] = "";
  }
}

function normalizePostcodeFields(target: Record<string, unknown>, fields: AddressFieldSet): void {
  const pcKey = fields.postcode!;
  if (isEmptyValue(target[pcKey])) return;
  const formatted = formatUkPostcode(String(target[pcKey]).trim());
  if (formatted) target[pcKey] = formatted;
}

/**
 * Fix Retell mis-extraction where a postcode lands in address line 1 or city
 * (Patricia Stocker / Almas / Charlotte patterns).
 * Runs on property + contact address field groups.
 */
export function sanitizeWbahUkAddressFields(target: Record<string, unknown>): void {
  for (const fields of [PROPERTY_FIELDS, CONTACT_FIELDS]) {
    movePostcodeOutOfLine1(target, fields);
    movePostcodeOutOfField(target, fields.city, fields.postcode!);
    movePostcodeOutOfField(target, fields.line2, fields.postcode!);
    normalizePostcodeFields(target, fields);
  }

  if (
    isEmptyValue(target.new_propinfo_postalcode) &&
    !isEmptyValue(target.address1_postalcode) &&
    !isEmptyValue(target.new_propinfo_street2)
  ) {
    target.new_propinfo_postalcode = target.address1_postalcode;
  }
}
