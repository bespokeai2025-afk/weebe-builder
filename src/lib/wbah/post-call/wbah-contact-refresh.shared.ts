/**
 * Keeping a WBAH contact row (wbah_crm_contacts, one per phone) on the latest call.
 *
 * The post-call mirror used to be insert-only, so a number that came back as a
 * new lead kept its old row — Danny Gee's call on 23 Oct showed as "Rajat Kumar,
 * Disqualified, booked 7 July". And the booked-contact syncs re-applied old
 * bookings over newer calls every few minutes. Rules:
 *
 *  - An older call never overwrites a row that already reflects a newer one.
 *  - A newer call refreshes the call fields (name, agent, status, sentiment,
 *    duration, recording, transcript) — only with values it actually has.
 *  - A new enquiry (different CRM lead id on the same number) also resets the
 *    lead status and the booking to this call's.
 *  - Same lead: this call's booking replaces the old one; with no booking on
 *    this call, a past appointment is cleared and a future one is kept.
 */

export type WbahContactRow = Record<string, unknown> & {
  external_id?: string | null;
  start_timestamp?: number | string | null;
  appointment_date?: string | null;
  calendly_booking_url?: string | null;
  meta?: Record<string, unknown> | null;
};

const CALL_FIELDS = [
  "name",
  "agent_name",
  "call_status",
  "sentiment",
  "disconnection_reason",
  "end_reason",
  "duration_ms",
  "start_timestamp",
  "recording_url",
  "transcript",
  "crm_loaded_at",
] as const;

const BOOKING_FIELDS = ["appointment_date", "appointment_time", "booking_status", "calendly_booking_url"] as const;

function present(v: unknown): boolean {
  return v != null && String(v).trim() !== "";
}

function ms(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The CRM lead a contact row belongs to, when known (placeholders are keyed by call id). */
export function wbahContactLeadId(row: WbahContactRow | null | undefined): string | null {
  const fromMeta = row?.meta && typeof row.meta === "object" ? row.meta.lead_id : null;
  if (present(fromMeta)) return String(fromMeta);
  const ext = String(row?.external_id ?? "").trim();
  return ext && !ext.startsWith("call_") && !ext.startsWith("id:") ? ext : null;
}

/** True when `incoming` is not older than the call the existing row reflects. */
export function isWbahContactUpdateCurrent(
  existing: WbahContactRow | null | undefined,
  incomingStartMs: unknown,
): boolean {
  const have = ms(existing?.start_timestamp);
  const next = ms(incomingStartMs);
  return have == null || next == null || next >= have;
}

export function planWbahContactRefresh(input: {
  existing: WbahContactRow;
  incoming: WbahContactRow;
  leadId: string | null;
  /** call_analyzed carries the booking outcome; call_ended does not. */
  hasOutcome: boolean;
  /** UK calendar date of this call, YYYY-MM-DD — anything before it is in the past. */
  callDate: string;
}): Record<string, unknown> | null {
  const { existing, incoming, leadId, hasOutcome, callDate } = input;
  if (!isWbahContactUpdateCurrent(existing, incoming.start_timestamp)) return null;

  const patch: Record<string, unknown> = {};
  for (const f of CALL_FIELDS) {
    if (present(incoming[f])) patch[f] = incoming[f];
  }
  if (present(incoming.name)) patch.full_name = incoming.name;

  const previousLead = wbahContactLeadId(existing);
  const newEnquiry = Boolean(leadId && previousLead && previousLead !== leadId);
  if (leadId) {
    patch.meta = { ...(existing.meta ?? {}), lead_id: leadId };
  }

  if (newEnquiry) {
    patch.external_id = leadId;
    if (present(incoming.lead_status)) patch.lead_status = incoming.lead_status;
    if (hasOutcome) {
      for (const f of BOOKING_FIELDS) patch[f] = present(incoming[f]) ? incoming[f] : null;
    }
  } else if (hasOutcome) {
    if (present(incoming.appointment_date) || present(incoming.calendly_booking_url)) {
      for (const f of BOOKING_FIELDS) patch[f] = present(incoming[f]) ? incoming[f] : null;
      // Same appointment, link not known on this call: keep the confirmed link.
      if (
        !present(incoming.calendly_booking_url) &&
        present(existing.calendly_booking_url) &&
        existing.appointment_date === incoming.appointment_date
      ) {
        patch.calendly_booking_url = existing.calendly_booking_url;
        patch.booking_status = existing.booking_status ?? patch.booking_status;
      }
    } else if (present(existing.appointment_date) && String(existing.appointment_date) < callDate) {
      for (const f of BOOKING_FIELDS) patch[f] = null;
    }
  }

  patch.synced_at = new Date().toISOString();
  return patch;
}
