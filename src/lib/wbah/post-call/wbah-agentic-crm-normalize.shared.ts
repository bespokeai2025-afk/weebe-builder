/**
 * Normalize structured_json_output.verified_details before Dynamics PATCH.
 * Mirrors n8n getAllValidFields + getALLValidFields1.
 */

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

function normalizeMobilePhone(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return trimmed;
  return `+${digits}`;
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
): Record<string, unknown> {
  const verified =
    structured.verified_details && typeof structured.verified_details === "object"
      ? (structured.verified_details as Record<string, unknown>)
      : {};
  const working: Record<string, unknown> = { ...structured, ...verified };

  applyVacantOrTenantedToPayload(working, working.vacant_or_tenanted);
  extractLeaseholdFromSummaries(custom, working);
  applyContactAddressSameAsProperty(working, working);

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
      out[key] = normalizeMobilePhone(value);
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
