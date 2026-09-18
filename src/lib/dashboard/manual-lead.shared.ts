/**
 * Normalising a manually-typed lead into the shape `upsertLead` accepts.
 *
 * Extracted from the Add Lead dialog because the empty-string handling is where this quietly goes
 * wrong: a blank optional field must become `null`, not `""`. The server validator happens to
 * tolerate `""` for email, but an empty `company_name` or `notes` would otherwise be stored as an
 * empty string rather than absent, and a phone with stray whitespace would be stored unusable —
 * phone is how calls and WhatsApp replies are matched back to the lead.
 */

export type ManualLeadInput = {
  full_name?: string;
  phone?: string;
  email?: string;
  company_name?: string;
  notes?: string;
};

export type ManualLeadPayload = {
  full_name: string | null;
  phone: string;
  email: string | null;
  company_name: string | null;
  notes: string | null;
  source: string;
};

/** Source recorded on a hand-typed lead; matches what upsertLead reports to notifications. */
export const MANUAL_LEAD_SOURCE = "Manual entry";

function orNull(value: string | undefined): string | null {
  const t = (value ?? "").trim();
  return t || null;
}

export function buildManualLeadPayload(input: ManualLeadInput): ManualLeadPayload {
  return {
    full_name: orNull(input.full_name),
    phone: (input.phone ?? "").trim(),
    email: orNull(input.email),
    company_name: orNull(input.company_name),
    notes: orNull(input.notes),
    source: MANUAL_LEAD_SOURCE,
  };
}

/**
 * Whether the form can be submitted. Mirrors upsertLead's `phone: z.string().min(3)` so the user
 * sees a disabled button instead of a validation error from the server.
 */
export function isManualLeadSubmittable(input: ManualLeadInput): boolean {
  return (input.phone ?? "").trim().length >= 3;
}
