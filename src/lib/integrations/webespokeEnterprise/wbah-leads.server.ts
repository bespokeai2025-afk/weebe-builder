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
