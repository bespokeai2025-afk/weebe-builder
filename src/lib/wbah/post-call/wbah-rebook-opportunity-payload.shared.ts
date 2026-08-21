/**
 * Dynamics Opportunity PATCH for Rebook Initial Consultation post-call.
 * Only attributes that exist on the opportunity entity (Lead cos_* fields are invalid).
 */
import { isWbahAppointmentConfirmed } from "./wbah-allens-logic.shared";
import type { formatWbahRetellCallData } from "./wbah-format-data.shared";

type FormatResult = ReturnType<typeof formatWbahRetellCallData>;

/** Dynamics Opportunity cr_hsdconsultation option set. */
export const REBOOK_HSD_CONSULTATION_BOOKED = 121590000;
export const REBOOK_HSD_CONSULTATION_NOT_BOOKED = 121590001;

const REBOOK_OPP_FIELD_ALIASES: Record<string, string> = {
  first_name: "new_firstname",
  firstname: "new_firstname",
  last_name: "new_lastname",
  lastname: "new_lastname",
  user_mobile: "new_mobile",
  mobilephone: "new_mobile",
  mobile: "new_mobile",
  user_email: "emailaddress",
  email_address: "emailaddress",
  emailaddress1: "emailaddress",
};

/** Verified PATCH-safe Opportunity attributes on WBAH Dynamics CRM. */
const REBOOK_OPP_ALLOWED = new Set([
  "new_firstname",
  "new_lastname",
  "new_mobile",
  "emailaddress",
  "crf6a_new_appointmentdatetime",
  "cr_dateofhsdconsultation",
  "cr_hsdconsultation",
]);

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function normalizeRebookOppKey(key: string): string | null {
  const k = key.trim().toLowerCase();
  if (REBOOK_OPP_FIELD_ALIASES[k]) return REBOOK_OPP_FIELD_ALIASES[k];
  if (REBOOK_OPP_ALLOWED.has(k)) return k;
  return null;
}

function flattenStructured(structured: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!structured) return {};
  const out: Record<string, unknown> = { ...structured };
  const verified = structured.verified_details;
  if (verified && typeof verified === "object" && !Array.isArray(verified)) {
    Object.assign(out, verified as Record<string, unknown>);
  }
  return out;
}

/** Set HSD consultation datetime + Booked picklist when Retell confirmed a slot. */
function applyRebookConsultationBooking(
  patch: Record<string, string | number | boolean | null>,
  formatted: FormatResult,
): void {
  const confirmed = isWbahAppointmentConfirmed({
    appointmentConfirmed: formatted.appointmentConfirmed,
    appointmentDate: formatted.appointmentDate,
    appointmentTime: formatted.appointmentTimeUk,
    requestedStartUtc: formatted.requestedStartUtc,
  });
  if (!confirmed || !formatted.requestedStartUtc) return;

  const appointmentIso = formatted.requestedStartUtc;
  patch.crf6a_new_appointmentdatetime = appointmentIso;
  patch.cr_dateofhsdconsultation = appointmentIso;
  patch.cr_hsdconsultation = REBOOK_HSD_CONSULTATION_BOOKED;
}

export function buildWbahRebookOpportunityPayload(input: {
  formatted: FormatResult;
  dynVars: Record<string, unknown>;
  custom: Record<string, unknown>;
}): Record<string, string | number | boolean | null> {
  const patch: Record<string, string | number | boolean | null> = {};
  const sources = [
    flattenStructured(input.formatted.structuredJsonOutput ?? undefined),
    input.custom,
    input.dynVars,
  ];

  for (const src of sources) {
    for (const [rawKey, rawVal] of Object.entries(src)) {
      const key = normalizeRebookOppKey(rawKey);
      if (!key || rawVal == null || rawVal === "") continue;
      if (typeof rawVal === "object") continue;
      patch[key] = rawVal as string | number | boolean;
    }
  }

  const first = pickStr(input.dynVars.first_name ?? input.dynVars.First_name);
  const last = pickStr(input.dynVars.last_name ?? input.dynVars.Last_name);
  if (first && !patch.new_firstname) patch.new_firstname = first;
  if (last && !patch.new_lastname) patch.new_lastname = last;

  const mobile =
    pickStr(input.dynVars.user_mobile ?? input.dynVars.mobile ?? input.formatted.phone) ??
    pickStr(input.dynVars.phone);
  if (mobile && !patch.new_mobile) patch.new_mobile = mobile;

  const email = pickStr(input.formatted.email ?? input.dynVars.user_email ?? input.dynVars.email);
  if (email && !patch.emailaddress) patch.emailaddress = email;

  applyRebookConsultationBooking(patch, input.formatted);

  return patch;
}

export { buildWbahAiTimelineNoteText as buildWbahRebookTimelineNote } from "./wbah-timeline-note.shared";
