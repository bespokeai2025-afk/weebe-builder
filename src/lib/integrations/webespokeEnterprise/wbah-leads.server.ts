import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cacheWrap } from "@/lib/cache/redis.server";

// ── Single source of truth for WBAH lead/booking derivation ────────────────────
// WBAH's `leads` table is dup-inflated (~400k rows), so any ORDER BY / COUNT over it
// breaches the DB statement timeout and silently returns 0. The dashboard, Sales
// Pipeline board and HiveMind (chat + pages) therefore all derive WBAH "leads" from
// the small, clean `wbah_calls` table instead: page latest-first, dedup per contact
// (phone), and treat a contact as "booked" when their most-recent call carries an
// appointment_date or a Calendly link.
//
// This helper centralises that paging/dedup/booking logic so the definition of a
// WBAH "lead" and "booking" lives in exactly ONE place. Sentiment filtering is left
// to callers because it differs by surface (the Pipeline board shows positive-only
// "qualified" contacts, while HiveMind counts positive+neutral as leads) — use the
// exported `isWbahPositive` / `isWbahPositiveOrNeutral` predicates so those filters
// stay consistent too. Uses the service-role client (wbah_calls is RLS-protected)
// and a short-TTL cache so callers don't rescan every call on each request.

export type WbahDerivedLead = {
  id: string;
  customer_name: string | null;
  phone: string | null;
  agent_name: string | null;
  call_status: string | null;
  /** lowercased sentiment of the contact's most-recent call, or null */
  sentiment: string | null;
  duration_seconds: number | null;
  started_at: string | null;
  appointment_date: string | null;
  booking_status: string | null;
  calendly_booking_url: string | null;
  /** true when the latest call has an appointment_date or a Calendly link */
  booked: boolean;
};

const SELECT_COLS =
  "id, customer_name, phone, agent_name, call_status, sentiment, duration_seconds, started_at, appointment_date, booking_status, calendly_booking_url";

// Returns one row per WBAH contact (their most-recent call), NOT filtered by
// sentiment. Callers apply their own sentiment filter (see predicates below).
export async function getWbahDerivedLeads(
  workspaceId: string,
): Promise<WbahDerivedLead[]> {
  return cacheWrap(`webee:wbah-derived-leads:${workspaceId}`, 60, async () => {
    const PAGE = 1000;
    const all: any[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await (supabaseAdmin as any)
        .from("wbah_calls")
        .select(SELECT_COLS)
        .eq("workspace_id", workspaceId)
        .order("started_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`DB query failed: ${error.message}`);
      const batch: any[] = data ?? [];
      all.push(...batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }

    // Dedup per contact (phone). Rows are latest-first, so the first time we see a
    // phone is that contact's most-recent call.
    const seen = new Set<string>();
    const latest: WbahDerivedLead[] = [];
    for (const c of all) {
      const key =
        c.phone && String(c.phone).trim()
          ? String(c.phone).trim()
          : `id:${c.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const booked = Boolean(
        (c.appointment_date && String(c.appointment_date).trim()) ||
          (c.calendly_booking_url && String(c.calendly_booking_url).trim()),
      );
      latest.push({
        id: c.id,
        customer_name: c.customer_name ?? null,
        phone: c.phone ?? null,
        agent_name: c.agent_name ?? null,
        call_status: c.call_status ?? null,
        sentiment: String(c.sentiment ?? "").toLowerCase() || null,
        duration_seconds: c.duration_seconds ?? null,
        started_at: c.started_at ?? null,
        appointment_date: c.appointment_date ?? null,
        booking_status: c.booking_status ?? null,
        calendly_booking_url: c.calendly_booking_url ?? null,
        booked,
      });
    }
    return latest;
  });
}

// "Qualified" for WBAH = latest call came back positive. Used by the Pipeline board.
export function isWbahPositive(lead: WbahDerivedLead): boolean {
  return lead.sentiment === "positive";
}

// A WBAH "lead" for HiveMind = latest call came back positive OR neutral.
export function isWbahPositiveOrNeutral(lead: WbahDerivedLead): boolean {
  return lead.sentiment === "positive" || lead.sentiment === "neutral";
}

const BOOKING_COLS =
  "id, customer_name, phone, agent_name, appointment_date, appointment_time, booking_status, calendly_booking_url";

function isWbahCallBooked(c: {
  appointment_date?: string | null;
  booking_status?: string | null;
  calendly_booking_url?: string | null;
}): boolean {
  if (c.calendly_booking_url != null && String(c.calendly_booking_url).trim() !== "") return true;
  const bs = String(c.booking_status ?? "").toLowerCase();
  if (bs === "success" || bs === "booked" || bs === "confirmed") return true;
  return !!(c.appointment_date && String(c.appointment_date).trim());
}

function normWbahBookingStatus(status: string | null | undefined): string {
  const s = String(status ?? "").toLowerCase();
  if (s === "success" || s === "booked" || s === "confirmed") return "confirmed";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  if (s === "pending") return "pending";
  return s || "confirmed";
}

export type WbahCalendarBookingRow = {
  id: string;
  title: string;
  start_at: string;
  end_at: string | null;
  status: string;
  attendee_name: string | null;
  attendee_phone: string | null;
  meeting_url: string | null;
  agent_name: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
};

/** Booked Calendly / CRM appointments for the WBAH calendar (one row per contact). */
export async function getWbahCalendarBookings(
  workspaceId: string,
): Promise<WbahCalendarBookingRow[]> {
  const { parseWbahAppointmentIso } = await import("@/lib/dashboard/wbah-appointment-display");

  return cacheWrap(`webee:wbah-calendar-bookings:${workspaceId}`, 60, async () => {
    const PAGE = 1000;
    const all: any[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await (supabaseAdmin as any)
        .from("wbah_calls")
        .select(BOOKING_COLS)
        .eq("workspace_id", workspaceId)
        .order("started_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`DB query failed: ${error.message}`);
      const batch: any[] = data ?? [];
      all.push(...batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }

    const bookingByPhone = new Map<string, any>();
    for (const c of all) {
      if (!isWbahCallBooked(c)) continue;
      const digits = String(c.phone ?? "").replace(/\D/g, "");
      const key = digits || `id:${c.id}`;
      if (!bookingByPhone.has(key)) bookingByPhone.set(key, c);
    }

    const crmBookingByDigits = new Map<string, any>();
    try {
      const { data: crm } = await (supabaseAdmin as any)
        .from("wbah_crm_contacts")
        .select("phone, name, booking_status, appointment_date, appointment_time, calendly_booking_url, agent_name")
        .eq("workspace_id", workspaceId);
      for (const r of (crm ?? []) as any[]) {
        if (!isWbahCallBooked(r)) continue;
        const d = String(r.phone ?? "").replace(/\D/g, "");
        if (d && !crmBookingByDigits.has(d)) crmBookingByDigits.set(d, r);
      }
    } catch {
      /* CRM enrichment is best-effort */
    }

    const seen = new Set<string>();
    const rows: WbahCalendarBookingRow[] = [];

    for (const c of bookingByPhone.values()) {
      const digits = String(c.phone ?? "").replace(/\D/g, "");
      const key = digits || `id:${c.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const crm = digits ? crmBookingByDigits.get(digits) : null;
      const src = crm ?? c;
      const startAt = parseWbahAppointmentIso(src.appointment_date, src.appointment_time);
      if (!startAt) continue;

      rows.push({
        id: String(c.id),
        title: `${src.name ?? c.customer_name ?? "Contact"} — Appointment`,
        start_at: startAt,
        end_at: null,
        status: normWbahBookingStatus(src.booking_status),
        attendee_name: src.name ?? c.customer_name ?? null,
        attendee_phone: c.phone ?? null,
        meeting_url: src.calendly_booking_url ?? c.calendly_booking_url ?? null,
        agent_name: c.agent_name ?? src.agent_name ?? null,
        appointment_date: src.appointment_date ?? null,
        appointment_time: src.appointment_time ?? null,
      });
    }

    for (const [digits, crm] of crmBookingByDigits) {
      if (seen.has(digits)) continue;
      const startAt = parseWbahAppointmentIso(crm.appointment_date, crm.appointment_time);
      if (!startAt) continue;
      seen.add(digits);
      rows.push({
        id: `crm:${digits}`,
        title: `${crm.name ?? "Contact"} — Appointment`,
        start_at: startAt,
        end_at: null,
        status: normWbahBookingStatus(crm.booking_status),
        attendee_name: crm.name ?? null,
        attendee_phone: crm.phone ?? null,
        meeting_url: crm.calendly_booking_url ?? null,
        agent_name: crm.agent_name ?? null,
        appointment_date: crm.appointment_date ?? null,
        appointment_time: crm.appointment_time ?? null,
      });
    }

    rows.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
    return rows;
  });
}
