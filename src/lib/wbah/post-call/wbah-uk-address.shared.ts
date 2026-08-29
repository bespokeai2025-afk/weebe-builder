/** UK address/postcode helpers for WBAH post-call CRM mapping. */

const UK_POSTCODE_CORE =
  /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i;

function isEmptyValue(v: unknown): boolean {
  return v == null || String(v).trim() === "";
}

/** Normalize to uppercase outward code + space, e.g. "m14 5pq" → "M14 5PQ". */
export function formatUkPostcode(raw: string): string | null {
  const compact = raw.replace(/\s+/g, "").toUpperCase();
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
