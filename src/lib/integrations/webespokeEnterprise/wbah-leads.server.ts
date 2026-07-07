import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cacheWrap } from "@/lib/cache/redis.server";
import {
  isWbahRecordBooked,
  loadWbahCrmBookingByDigits,
  findWbahBookingCall,
  resolveWbahBookingFields,
  phoneDigits,
  type WbahBookingFields,
} from "@/lib/dashboard/wbah-booking-meta";
import { parseWbahAppointmentIso } from "@/lib/dashboard/wbah-appointment-display";

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

/** Columns shared by Leads, Qualified, and Calendar derivation (one paginated scan). */
const AGGREGATE_COLS =
  "id, customer_name, phone, agent_name, call_status, sentiment, duration_seconds, started_at, recording_url, disconnection_reason, end_reason, appointment_date, appointment_time, booking_status, calendly_booking_url";

const WBAH_AGGREGATE_TTL = 180;

export type WbahCallsAggregate = {
  all: any[];
  byPhone: Map<string, any[]>;
  crmBookingByDigits: Map<string, WbahBookingFields & { name?: string | null; phone?: string | null }>;
};

type WbahCallsAggregateCached = {
  all: any[];
  crm: Record<string, WbahBookingFields & { name?: string | null; phone?: string | null }>;
};

function buildWbahByPhone(all: any[]): Map<string, any[]> {
  const byPhone = new Map<string, any[]>();
  for (const c of all) {
    const key = phoneDigits(c.phone) || `id:${c.id}`;
    const arr = byPhone.get(key) ?? [];
    arr.push(c);
    byPhone.set(key, arr);
  }
  return byPhone;
}

/**
 * Single cached scan of wbah_calls + CRM booking map. Leads, Qualified, and
 * Calendar all derive from this instead of each paging the full table.
 */
async function ensureWbahBookedContactsInDb(workspaceId: string): Promise<void> {
  const { count } = await (supabaseAdmin as any)
    .from("wbah_crm_contacts")
    .select("dedup_key", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .in("booking_status", ["success", "booked", "confirmed"]);
  if ((count ?? 0) > 0) return;
  try {
    const { syncWbahBookedContactsFromCrm } = await import("./wbah-leads-sync-tick");
    const res = await syncWbahBookedContactsFromCrm({ force: true });
    if (res.rows > 0) {
      const { cacheDel } = await import("@/lib/cache/redis.server");
      await cacheDel(`webee:wbah-calls-aggregate:v3:${workspaceId}`);
    }
  } catch (e: any) {
    console.warn("[WBAH aggregate] booked CRM sync failed:", e?.message ?? e);
  }
}

export async function getWbahCallsAggregate(workspaceId: string): Promise<WbahCallsAggregate> {
  await ensureWbahBookedContactsInDb(workspaceId);
  const cached = await cacheWrap(`webee:wbah-calls-aggregate:v3:${workspaceId}`, WBAH_AGGREGATE_TTL, async () => {
    const crmMap = await loadWbahCrmBookingByDigits(supabaseAdmin, workspaceId);
    const crm: WbahCallsAggregateCached["crm"] = {};
    crmMap.forEach((v, k) => { crm[k] = v; });

    const PAGE = 1000;
    const all: any[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await (supabaseAdmin as any)
        .from("wbah_calls")
        .select(AGGREGATE_COLS)
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
    console.log(`[WBAH aggregate] calls=${all.length} crm_bookings=${Object.keys(crm).length}`);
    return { all, crm };
  });

  const crmBookingByDigits = new Map(Object.entries(cached.crm));
  return { all: cached.all, byPhone: buildWbahByPhone(cached.all), crmBookingByDigits };
}

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
  const { byPhone, crmBookingByDigits } = await getWbahCallsAggregate(workspaceId);

  const seen = new Set<string>();
  const rows: WbahCalendarBookingRow[] = [];

  const pushRow = (
    key: string,
    c: any,
    appt: ReturnType<typeof resolveWbahBookingFields>,
    crm?: { name?: string | null } | null,
  ) => {
    if (seen.has(key) || !isWbahRecordBooked(appt)) return;
    const startAt = parseWbahAppointmentIso(
      appt.appointment_date,
      appt.appointment_time,
      c.started_at ?? null,
    );
    if (!startAt) return;
    seen.add(key);
    rows.push({
      id: String(c.id ?? key),
      title: `${crm?.name ?? c.customer_name ?? "Contact"} — Appointment`,
      start_at: startAt,
      end_at: null,
      status: normWbahBookingStatus(appt.booking_status),
      attendee_name: crm?.name ?? c.customer_name ?? null,
      attendee_phone: c.phone ?? null,
      meeting_url: appt.calendly_booking_url ?? null,
      agent_name: appt.agent_name ?? null,
      appointment_date: appt.appointment_date ?? null,
      appointment_time: appt.appointment_time ?? null,
    });
  };

  for (const [key, calls] of byPhone) {
    const main = calls[0];
    const bookingCall = findWbahBookingCall(calls);
    const crm = phoneDigits(main.phone) ? crmBookingByDigits.get(phoneDigits(main.phone)) : null;
    const appt = resolveWbahBookingFields(main, bookingCall, crm);
    pushRow(key, main, appt, crm);
  }

  for (const [digits, crm] of crmBookingByDigits) {
    if (seen.has(digits)) continue;
    const appt = resolveWbahBookingFields({}, null, crm);
    pushRow(digits, { id: `crm:${digits}`, phone: crm.phone, customer_name: crm.name, started_at: null }, appt, crm);
  }

  rows.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  console.log(`[WBAH calendar] booked appointments: ${rows.length} (crm=${crmBookingByDigits.size})`);
  return rows;
}
