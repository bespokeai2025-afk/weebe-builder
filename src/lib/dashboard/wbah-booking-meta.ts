/**
 * Shared WBAH booking detection + CRM enrichment.
 * Booking data lives in WeeBespoke CRM (wbah_crm_contacts); Retell sync does not
 * carry Calendly fields and would wipe them without merge-on-upsert.
 */

export type WbahBookingFields = {
  appointment_date?: string | null;
  appointment_time?: string | null;
  booking_status?: string | null;
  calendly_booking_url?: string | null;
  agent_name?: string | null;
};

export function isWbahRecordBooked(c: WbahBookingFields | null | undefined): boolean {
  if (!c) return false;
  if (c.calendly_booking_url != null && String(c.calendly_booking_url).trim() !== "") return true;
  const bs = String(c.booking_status ?? "").toLowerCase();
  if (bs === "success" || bs === "booked" || bs === "confirmed") return true;
  return !!(c.appointment_date && String(c.appointment_date).trim());
}

export function phoneDigits(phone: string | null | undefined): string {
  return String(phone ?? "").replace(/\D/g, "");
}

/** Pick the best booking-bearing call from a contact's call history (latest first). */
export function findWbahBookingCall<T extends WbahBookingFields>(calls: T[]): T | null {
  for (const c of calls) {
    if (c.calendly_booking_url != null && String(c.calendly_booking_url).trim() !== "") return c;
  }
  for (const c of calls) {
    if (isWbahRecordBooked(c)) return c;
  }
  return null;
}

/** Merge booking fields: CRM → dedicated booking call → main/latest call. */
export function resolveWbahBookingFields(
  main: WbahBookingFields,
  bookingCall?: WbahBookingFields | null,
  crm?: WbahBookingFields | null,
): WbahBookingFields {
  const appt = crm ?? bookingCall ?? main;
  return {
    appointment_date: appt.appointment_date ?? bookingCall?.appointment_date ?? main.appointment_date ?? null,
    appointment_time: appt.appointment_time ?? bookingCall?.appointment_time ?? main.appointment_time ?? null,
    booking_status: appt.booking_status ?? bookingCall?.booking_status ?? main.booking_status ?? null,
    calendly_booking_url:
      appt.calendly_booking_url ?? bookingCall?.calendly_booking_url ?? main.calendly_booking_url ?? null,
    agent_name: main.agent_name ?? bookingCall?.agent_name ?? crm?.agent_name ?? appt.agent_name ?? null,
  };
}

export async function loadWbahCrmBookingByDigits(
  supabaseAdmin: { from: (t: string) => any },
  workspaceId: string,
): Promise<Map<string, WbahBookingFields & { name?: string | null; phone?: string | null }>> {
  const map = new Map<string, WbahBookingFields & { name?: string | null; phone?: string | null }>();
  try {
    const { data: crm } = await (supabaseAdmin as any)
      .from("wbah_crm_contacts")
      .select("phone, name, booking_status, appointment_date, appointment_time, calendly_booking_url, agent_name")
      .eq("workspace_id", workspaceId);
    for (const r of (crm ?? []) as any[]) {
      if (!isWbahRecordBooked(r)) continue;
      const d = phoneDigits(r.phone);
      if (d && !map.has(d)) map.set(d, r);
    }
  } catch (e: any) {
    console.warn("[wbah-booking-meta] CRM load failed:", e?.message ?? e);
  }
  return map;
}

/** Overlay CRM / historical-call booking fields onto wbah_calls rows (for Calls page). */
export async function enrichWbahCallRowsWithBookings(
  supabaseAdmin: { from: (t: string) => any },
  workspaceId: string,
  rows: any[],
): Promise<any[]> {
  if (rows.length === 0) return rows;
  const crmBookingByDigits = await loadWbahCrmBookingByDigits(supabaseAdmin, workspaceId);

  const byPhone = new Map<string, any[]>();
  for (const r of rows) {
    const key = phoneDigits(r.phone) || `id:${r.id}`;
    const arr = byPhone.get(key) ?? [];
    arr.push(r);
    byPhone.set(key, arr);
  }

  return rows.map((r) => {
    const key = phoneDigits(r.phone) || `id:${r.id}`;
    const calls = byPhone.get(key) ?? [r];
    const bookingCall = findWbahBookingCall(calls);
    const crm = phoneDigits(r.phone) ? crmBookingByDigits.get(phoneDigits(r.phone)) : null;
    const appt = resolveWbahBookingFields(r, bookingCall, crm);
    return {
      ...r,
      appointment_date: appt.appointment_date ?? r.appointment_date ?? null,
      appointment_time: appt.appointment_time ?? r.appointment_time ?? null,
      booking_status: appt.booking_status ?? r.booking_status ?? null,
      calendly_booking_url: appt.calendly_booking_url ?? r.calendly_booking_url ?? null,
      agent_name: appt.agent_name ?? r.agent_name ?? null,
    };
  });
}
