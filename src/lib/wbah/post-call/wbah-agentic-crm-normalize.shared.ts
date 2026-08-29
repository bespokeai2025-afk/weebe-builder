/**
 * Normalize structured_json_output.verified_details before Dynamics PATCH.
 * Mirrors n8n getAllValidFields + getALLValidFields1.
 */

import { enrichWbahVerifiedDetailsFromSummaries, applyOwnerOccupiedCorrection } from "./wbah-crm-enrichment.shared";
import { sanitizeWbahUkAddressFields } from "./wbah-uk-address.shared";
import { normalizeWbahUkMobilePhone } from "./wbah-uk-phone.shared";
import { pickWbahCrmEmail } from "./wbah-email.shared";
import {
  applyContactAddressSameAsProperty,
  applyVacantOrTenantedToPayload,
  WBAH_VERIFIED_DETAILS_ALIASES,
  WBAH_VERIFIED_DETAILS_DYNAMICS_FIELDS,
  WBAH_VERIFIED_DETAILS_EXCLUDED_KEYS,
} from "./wbah-verified-details-dynamics.shared";

export const WBAH_AGENTIC_DYNAMICS_FIELDS = WBAH_VERIFIED_DETAILS_DYNAMICS_FIELDS;

const AGENTIC_EXTRACTION_ALIASES = WBAH_VERIFIED_DETAILS_ALIASES;
const AGENTIC_EXCLUDED_KEYS = WBAH_VERIFIED_DETAILS_EXCLUDED_KEYS;

function isEmptyValue(v: unknown): boolean {
  return v == null || String(v).trim() === "";
}

function boolVal(v: unknown): boolean | undefined {
  if (v === true || v === false) return v;
  if (isEmptyValue(v)) return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === "true" || s === "yes" || s === "1") return true;
  if (s === "false" || s === "no" || s === "0") return false;
  return undefined;
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
  transcript?: string | null,
): Record<string, unknown> {
  const verified =
    structured.verified_details && typeof structured.verified_details === "object"
      ? (structured.verified_details as Record<string, unknown>)
      : {};
  const working: Record<string, unknown> = { ...structured, ...verified };

  enrichWbahVerifiedDetailsFromSummaries(working, custom, transcript);
  sanitizeWbahUkAddressFields(working);
  applyVacantOrTenantedToPayload(working, working.vacant_or_tenanted);
  applyOwnerOccupiedCorrection(working, custom, verified);
  extractLeaseholdFromSummaries(custom, working);
  applyContactAddressSameAsProperty(working, working, custom, transcript);

  for (const [alias, canonical] of Object.entries(AGENTIC_EXTRACTION_ALIASES)) {
    const aliasVal = working[alias];
    if (isEmptyValue(aliasVal)) continue;
    if (isEmptyValue(working[canonical])) {
      working[canonical] = aliasVal;
    }
  }

  const decisionMaker = boolVal(working.decision_maker);
  if (decisionMaker !== undefined && isEmptyValue(working.decisionmaker)) {
    working.decisionmaker = decisionMaker;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(working)) {
    if (AGENTIC_EXCLUDED_KEYS.has(key)) continue;
    if (!WBAH_AGENTIC_DYNAMICS_FIELDS.has(key)) continue;
    if (isEmptyValue(value)) continue;

    if (key === "mobilephone" && typeof value === "string") {
      const normalized = normalizeWbahUkMobilePhone(value);
      if (normalized) out[key] = normalized;
      continue;
    }
    if (key === "new_othervendor_hometelephone" && typeof value === "string") {
      const normalized = normalizeWbahUkMobilePhone(value);
      if (normalized) out[key] = normalized;
      continue;
    }
    if (key === "emailaddress1" && typeof value === "string") {
      const email = pickWbahCrmEmail(value);
      if (email) out[key] = email;
      continue;
    }

    if (key === "decisionmaker") {
      const b = boolVal(value);
      if (b !== undefined) out[key] = b;
      continue;
    }

    out[key] = value;
  }

  return out;
}
