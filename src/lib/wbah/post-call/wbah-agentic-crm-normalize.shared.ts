/**
 * Normalize structured_json_output.verified_details before Dynamics PATCH.
 * Mirrors n8n getAllValidFields + getALLValidFields1.
 */

/** Extraction aliases that are NOT valid Dynamics lead attribute names. */
const AGENTIC_EXTRACTION_ALIASES: Record<string, string> = {
  property_type: "new_propinfo_typeofproperty",
  tenure: "cos_tenure",
  timeframe: "new_propinfo_howquickly",
  floor: "new_propinfo_whichfloor",
  first_name: "firstname",
  last_name: "lastname",
  user_email: "emailaddress1",
  email_address: "emailaddress1",
  user_mobile: "mobilephone",
  title: "new_contact_title",
  no_of_bedrooms: "new_propinfo_numberofbedrooms",
  floor_number_if_apartment: "new_propinfo_whichfloor",
  is_property_currently_vacant: "cos_propertyempty",
  is_property_currently_rented: "cos_propertyrented",
  ground_rent: "cos_groundrent",
  service_charge: "cos_servicecharge",
  years_on_lease: "cos_numberofyearsonlease",
  numberofyearsonlease: "cos_numberofyearsonlease",
  sellers_timeframe: "new_propinfo_howquickly",
  property_empty: "cos_propertyempty",
  property_rented: "cos_propertyrented",
};

/** Keys never sent on PATCH (aliases handled above, or internal-only). */
const AGENTIC_EXCLUDED_KEYS = new Set([
  "property_type",
  "vacant_or_tenanted",
  "tenure",
  "floor",
  "on_market",
  "timeframe",
  "is_need_to_call_again_for_booking",
  "verified_details",
  /** Retell extraction only — not a Dynamics lead attribute. */
  "decision_maker",
  "first_name",
  "last_name",
  "user_email",
  "email_address",
  "user_mobile",
  "title",
]);

/** Dynamics lead fields allowed from WBAH structured_json_output (production n8n set). */
export const WBAH_AGENTIC_DYNAMICS_FIELDS = new Set([
  "new_propinfo_numberofbedrooms",
  "cos_propertyempty",
  "cos_propertyrented",
  "cos_sharedownership",
  "cos_sellrentback",
  "cos_parkhome",
  "cos_commercial",
  "cos_tenure",
  "new_propinfo_howquickly",
  "cos_sourcetype",
  "new_contact_title",
  "cos_groundrent",
  "cos_servicecharge",
  "cos_numberofyearsonlease",
  "new_propinfo_street2",
  "new_propinfo_street3",
  "new_propinfo_city",
  "address1_line1",
  "address1_line2",
  "address1_city",
  "new_propinfo_stateorprovince",
  "address1_stateorprovince",
  "address1_postalcode",
  "new_propinfo_postalcode",
  "firstname",
  "lastname",
  "emailaddress1",
  "new_othervendor_hometelephone",
  "mobilephone",
  "cos_call_summary",
  "new_propinfo_typeofproperty",
  "new_propinfo_whichfloor",
]);

function isEmptyValue(v: unknown): boolean {
  return v == null || String(v).trim() === "";
}

function normalizeMobilePhone(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return trimmed;
  return `+${digits}`;
}

/** n8n vacant_or_tenanted picklist → cos_propertyempty / cos_propertyrented */
function applyVacantOrTenanted(
  target: Record<string, unknown>,
  vacantOrTenanted: unknown,
): void {
  const code = String(vacantOrTenanted ?? "").trim();
  if (!code) return;
  if (code === "181510001" && isEmptyValue(target.cos_propertyempty)) {
    target.cos_propertyempty = "181510001";
  }
  if (code === "181510000" && isEmptyValue(target.cos_propertyrented)) {
    target.cos_propertyrented = "181510000";
  }
}

function extractLeaseholdFromSummaries(
  custom: Record<string, unknown> | undefined,
  working: Record<string, unknown>,
): void {
  const summary = String(custom?.detailed_call_summary ?? "");
  const callSummary = String(working.cos_call_summary ?? "");
  const combined = `${summary} ${callSummary}`;

  if (isEmptyValue(working.cos_groundrent)) {
    const m = combined.match(/ground\s*rent\s*(?:and\s*service\s*charge\s*)?[£$]?\s*(\d[\d,]*\d|\d+)/i);
    if (m) working.cos_groundrent = m[1].replace(/,/g, "");
  }
  if (isEmptyValue(working.cos_servicecharge)) {
    const m =
      combined.match(/service\s*charge\s*[£$]?\s*(\d[\d,]*\d|\d+)/i) ||
      combined.match(/ground\s*rent\s*and\s*service\s*charge\s*[£$]?\s*(\d[\d,]*\d|\d+)\s*each/i);
    if (m) working.cos_servicecharge = (m[1] || "").replace(/,/g, "");
  }
  if (isEmptyValue(working.cos_numberofyearsonlease)) {
    const m = combined.match(/(?:lease[\s\w]*?)\b(\d+)\s*(?:year|yr)/i);
    if (m) working.cos_numberofyearsonlease = m[1];
  }
}

/** Map aliases → CRM fields and keep only PATCH-safe Dynamics attribute names. */
export function normalizeWbahAgenticCrmFields(
  structured: Record<string, unknown>,
  custom?: Record<string, unknown>,
): Record<string, unknown> {
  const verified =
    structured.verified_details && typeof structured.verified_details === "object"
      ? (structured.verified_details as Record<string, unknown>)
      : {};
  const working: Record<string, unknown> = { ...structured, ...verified };

  applyVacantOrTenanted(working, working.vacant_or_tenanted);
  extractLeaseholdFromSummaries(custom, working);

  for (const [alias, canonical] of Object.entries(AGENTIC_EXTRACTION_ALIASES)) {
    const aliasVal = working[alias];
    if (isEmptyValue(aliasVal)) continue;
    if (isEmptyValue(working[canonical])) {
      working[canonical] = aliasVal;
    }
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(working)) {
    if (AGENTIC_EXCLUDED_KEYS.has(key)) continue;
    if (!WBAH_AGENTIC_DYNAMICS_FIELDS.has(key)) continue;
    if (isEmptyValue(value)) continue;

    if (key === "mobilephone" && typeof value === "string") {
      out[key] = normalizeMobilePhone(value);
      continue;
    }

    out[key] = value;
  }

  return out;
}
