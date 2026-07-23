import { createHash } from "node:crypto";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cacheWrap } from "@/lib/cache/redis.server";
import {
  isWbahRecordBooked,
  loadWbahCrmBookingByDigits,
  findWbahBookingCall,
  resolveWbahBookingFields,
  listWbahBookedContacts,
  phoneDigits,
  WBAH_BOOKED_STATUSES,
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

const WBAH_AGGREGATE_CACHE_KEY = "webee:wbah-calls-aggregate:v5";

async function countBookedCallsInDb(workspaceId: string): Promise<number> {
  const sb = supabaseAdmin as any;
  const COLS =
    "id, phone, appointment_date, appointment_time, booking_status, calendly_booking_url";
  let count = 0;
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    // Only rows with at least one booking signal — avoids scanning the full
    // wbah_calls table (16k+ rows) just to count the handful of booked ones.
    const { data, error } = await sb
      .from("wbah_calls")
      .select(COLS)
      .eq("workspace_id", workspaceId)
      .or("calendly_booking_url.not.is.null,appointment_date.not.is.null,booking_status.not.is.null")
      .range(from, from + PAGE - 1);
    if (error) break;
    const batch = (data ?? []) as any[];
    for (const c of batch) {
      if (isWbahRecordBooked(c)) count++;
    }
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return count;
}

/**
 * Single cached scan of wbah_calls + CRM booking map. Leads, Qualified, and
 * Calendar all derive from this instead of each paging the full table.
 */
async function ensureWbahBookedContactsInDb(workspaceId: string): Promise<void> {
  const sb = supabaseAdmin as any;
  const { count: crmBookedCount } = await sb
    .from("wbah_crm_contacts")
    .select("dedup_key", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .in("booking_status", [...WBAH_BOOKED_STATUSES]);
  const { count: datedCount } = await sb
    .from("wbah_crm_contacts")
    .select("dedup_key", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .in("booking_status", [...WBAH_BOOKED_STATUSES])
    .not("appointment_date", "is", null);
  const { count: crmWithCalendly } = await sb
    .from("wbah_crm_contacts")
    .select("dedup_key", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .not("calendly_booking_url", "is", null);

  const crmHint = Math.max(crmBookedCount ?? 0, crmWithCalendly ?? 0);
  const callsBooked = crmHint < 30 || (datedCount ?? 0) === 0
    ? await countBookedCallsInDb(workspaceId)
    : 0;

  const needsSync =
    crmHint === 0 ||
    ((crmBookedCount ?? 0) > 0 && (datedCount ?? 0) === 0 && (crmWithCalendly ?? 0) === 0) ||
    (callsBooked > 0 && callsBooked > crmHint + 5);

  if (!needsSync) return;

  try {
    const {
      syncWbahBookedContactsFromCrm,
      syncWbahBookedContactsFromCalls,
      refreshWbahAppointmentBackfill,
    } = await import("./wbah-leads-sync-tick");

    await refreshWbahAppointmentBackfill({ maxPages: 25, force: true });
    const [crmRes, callsRes] = await Promise.all([
      syncWbahBookedContactsFromCrm({ force: true }),
      syncWbahBookedContactsFromCalls({ force: true }),
    ]);

    if (crmRes.rows > 0 || callsRes.rows > 0 || callsBooked > crmHint) {
      await invalidateWbahAggregate(workspaceId);
    }
  } catch (e: any) {
    console.warn("[WBAH aggregate] booked sync failed:", e?.message ?? e);
  }
}

// The booked-contacts consistency repair can take tens of seconds when it has
// to talk to WeeBespoke — it must NEVER block a page read. Run it in the
// background, single-flight, at most once per interval. Reads render from the
// data already in wbah_calls/wbah_crm_contacts; the repair busts the aggregate
// cache itself when it changes rows, so the next read picks up the fixes.
let _ensureBookedInflight: Promise<void> | null = null;
let _ensureBookedLastAt = 0;
const ENSURE_BOOKED_MIN_INTERVAL_MS = 5 * 60 * 1000;

function scheduleEnsureWbahBookedContacts(workspaceId: string): void {
  if (_ensureBookedInflight) return;
  if (Date.now() - _ensureBookedLastAt < ENSURE_BOOKED_MIN_INTERVAL_MS) return;
  _ensureBookedInflight = ensureWbahBookedContactsInDb(workspaceId)
    .catch((e: any) => console.warn("[WBAH aggregate] booked ensure failed:", e?.message ?? e))
    .finally(() => {
      _ensureBookedLastAt = Date.now();
      _ensureBookedInflight = null;
    });
}

// ── In-process aggregate cache ────────────────────────────────────────────────
// The serialized aggregate is ~8MB, which exceeds the Redis layer's 5MB SET cap
// — Redis silently skips the write, so cacheWrap alone gave us NO caching at
// all: every Leads/Qualified/Calendar open paid a full rebuild. Cache the built
// aggregate in process memory with the same TTL, and single-flight concurrent
// cold reads (the login prefetch fires several at once) so they share one
// rebuild instead of racing.
const _aggMem = new Map<string, { at: number; data: WbahCallsAggregateCached }>();
const _aggInflight = new Map<string, Promise<WbahCallsAggregateCached>>();

/**
 * Bust the WBAH calls aggregate (memory + Redis) for a workspace. All sync
 * jobs that change wbah_calls/wbah_crm_contacts rows must call this instead
 * of cacheDel'ing the Redis key directly, or the in-memory copy goes stale.
 */
export async function invalidateWbahAggregate(workspaceId: string): Promise<void> {
  _aggMem.delete(workspaceId);
  const { cacheDel } = await import("@/lib/cache/redis.server");
  await cacheDel(`${WBAH_AGGREGATE_CACHE_KEY}:${workspaceId}`);
}

export async function getWbahCallsAggregate(workspaceId: string): Promise<WbahCallsAggregate> {
  scheduleEnsureWbahBookedContacts(workspaceId);

  const mem = _aggMem.get(workspaceId);
  if (mem && Date.now() - mem.at < WBAH_AGGREGATE_TTL * 1000) {
    const crmBookingByDigits = new Map(Object.entries(mem.data.crm));
    return { all: mem.data.all, byPhone: buildWbahByPhone(mem.data.all), crmBookingByDigits };
  }

  let inflight = _aggInflight.get(workspaceId);
  if (!inflight) {
    inflight = buildWbahCallsAggregateCached(workspaceId)
      .then((data) => {
        _aggMem.set(workspaceId, { at: Date.now(), data });
        return data;
      })
      .finally(() => _aggInflight.delete(workspaceId));
    _aggInflight.set(workspaceId, inflight);
  }
  const cached = await inflight;

  const crmBookingByDigits = new Map(Object.entries(cached.crm));
  return { all: cached.all, byPhone: buildWbahByPhone(cached.all), crmBookingByDigits };
}

async function buildWbahCallsAggregateCached(workspaceId: string): Promise<WbahCallsAggregateCached> {
  return await cacheWrap(`${WBAH_AGGREGATE_CACHE_KEY}:${workspaceId}`, WBAH_AGGREGATE_TTL, async () => {
    const crmMap = await loadWbahCrmBookingByDigits(supabaseAdmin, workspaceId);
    const crm: WbahCallsAggregateCached["crm"] = {};
    crmMap.forEach((v, k) => { crm[k] = v; });

    // Count first, then fetch all pages IN PARALLEL — the sequential page walk
    // took ~6s for 16k+ rows; parallel fetch is roughly one round-trip.
    const PAGE = 1000;
    const t0 = Date.now();
    const { count, error: countErr } = await (supabaseAdmin as any)
      .from("wbah_calls")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);
    if (countErr) throw new Error(`DB count failed: ${countErr.message}`);
    // +1 page of headroom in case rows land between the count and the fetch.
    const total = (count ?? 0) + PAGE;
    const offsets: number[] = [];
    for (let from = 0; from < total; from += PAGE) offsets.push(from);

    const pages = await Promise.all(
      offsets.map(async (from) => {
        const { data, error } = await (supabaseAdmin as any)
          .from("wbah_calls")
          .select(AGGREGATE_COLS)
          .eq("workspace_id", workspaceId)
          .order("started_at", { ascending: false, nullsFirst: false })
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`DB query failed: ${error.message}`);
        return (data ?? []) as any[];
      }),
    );
    // Dedupe by id in case concurrent inserts shifted rows across page borders.
    const seen = new Set<string>();
    const all: any[] = [];
    for (const batch of pages) {
      for (const row of batch) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        all.push(row);
      }
    }
    console.log(`[WBAH aggregate] calls=${all.length} crm_bookings=${Object.keys(crm).length} in ${Date.now() - t0}ms`);
    return { all, crm };
  });
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

/** Resolve a calendar placement time; never falls back to call date. */
function wbahCalendarStartIso(appt: WbahBookingFields): string | null {
  const iso = parseWbahAppointmentIso(
    appt.appointment_date,
    appt.appointment_time,
    appt.calendly_booking_url,
  );
  if (iso) return iso;
  const d = appt.appointment_date && String(appt.appointment_date).trim();
  if (!d) return null;
  const parsed = Date.parse(d);
  if (!isNaN(parsed)) return new Date(parsed).toISOString();
  return null;
}

/** Booked Calendly / CRM appointments for the WBAH calendar (one row per contact). */
export async function getWbahCalendarBookings(
  workspaceId: string,
): Promise<WbahCalendarBookingRow[]> {
  const aggregate = await getWbahCallsAggregate(workspaceId);
  const booked = listWbahBookedContacts(aggregate);

  const rows: WbahCalendarBookingRow[] = [];
  let skipped = 0;

  for (const b of booked) {
    const startAt = wbahCalendarStartIso(b.appt);
    if (!startAt) {
      skipped++;
      console.warn(
        `[WBAH calendar] skip unparseable appointment key=${b.key} date=${b.appt.appointment_date ?? "—"} time=${b.appt.appointment_time ?? "—"}`,
      );
      continue;
    }
    const main = b.calls[0];
    rows.push({
      id: b.id,
      title: `${b.customer_name ?? "Contact"} — Appointment`,
      start_at: startAt,
      end_at: null,
      status: normWbahBookingStatus(b.appt.booking_status),
      attendee_name: b.customer_name,
      attendee_phone: b.phone,
      meeting_url: b.appt.calendly_booking_url ?? null,
      agent_name: b.appt.agent_name ?? main?.agent_name ?? null,
      appointment_date: b.appt.appointment_date ?? null,
      appointment_time: b.appt.appointment_time ?? null,
    });
  }

  rows.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  console.log(
    `[WBAH calendar] booked appointments: ${rows.length} total=${booked.length} skipped_unparseable=${skipped} crm=${aggregate.crmBookingByDigits.size}`,
  );
  return rows;
}

const PEOPLE_CALL_LOOKUP_COLS =
  "id, phone, agent_name, call_status, sentiment, duration_seconds, started_at, recording_url, call_summary, transcript, disconnection_reason, end_reason, appointment_date, appointment_time, booking_status, calendly_booking_url, meta";

const PEOPLE_CALL_LOOKUP_TTL = 120;

function phoneTail(phone: string | null | undefined): string | null {
  const d = phoneDigits(phone);
  return d.length >= 10 ? d.slice(-10) : null;
}

function peopleCallLookupHash(tails: string[]): string {
  return createHash("sha256")
    .update(tails.slice().sort().join(","))
    .digest("hex")
    .slice(0, 12);
}

/** Latest wbah_calls row per phone tail — one indexed query instead of scanning all calls. */
export async function getLatestWbahCallsForPhones(
  workspaceId: string,
  phones: (string | null | undefined)[],
): Promise<Map<string, Record<string, unknown>>> {
  const tails = [
    ...new Set(phones.map(phoneTail).filter((t): t is string => Boolean(t))),
  ];
  if (!tails.length) return new Map();

  const hash = peopleCallLookupHash(tails);
  const cached = await cacheWrap(
    `webee:wbah-people-call-lookup:v1:${workspaceId}:${hash}`,
    PEOPLE_CALL_LOOKUP_TTL,
    async () => {
      const sb = supabaseAdmin as any;
      const byTail = new Map<string, Record<string, unknown>>();
      const CHUNK = 25;

      for (let i = 0; i < tails.length; i += CHUNK) {
        const chunk = tails.slice(i, i + CHUNK);
        const orFilter = chunk.map((t) => `phone.ilike.%${t}`).join(",");
        const { data, error } = await sb
          .from("wbah_calls")
          .select(PEOPLE_CALL_LOOKUP_COLS)
          .eq("workspace_id", workspaceId)
          .or(orFilter)
          .order("started_at", { ascending: false })
          .limit(250);
        if (error) throw new Error(`wbah_calls phone lookup failed: ${error.message}`);

        for (const call of (data ?? []) as Record<string, unknown>[]) {
          const tail = phoneTail(String(call.phone ?? ""));
          if (tail && !byTail.has(tail)) byTail.set(tail, call);
        }
      }

      return Object.fromEntries(byTail);
    },
  );

  const byTail = new Map<string, Record<string, unknown>>(Object.entries(cached));
  const lookup = new Map<string, Record<string, unknown>>();
  for (const p of phones) {
    const tail = phoneTail(p);
    if (!tail) continue;
    const call = byTail.get(tail);
    if (!call) continue;
    const digits = phoneDigits(p);
    if (digits) lookup.set(digits, call);
    if (digits.startsWith("0") && digits.length >= 10) lookup.set(`44${digits.slice(1)}`, call);
    if (digits.startsWith("44") && digits.length >= 12) lookup.set(`0${digits.slice(2)}`, call);
    lookup.set(tail, call);
  }
  return lookup;
}
