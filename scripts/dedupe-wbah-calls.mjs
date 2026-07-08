// One-off cleanup for wbah_calls duplicate rows created when WeeBespoke's
// call-history sync fell back to its own internal `_id`/`id` (instead of a
// real Retell call_id) and mis-derived `started_at` from the call's END time.
// This mirrors the matching logic added to dedupeAgainstRetellRows() in
// src/lib/integrations/webespokeEnterprise/wbah-leads-sync-tick.ts, which now
// prevents NEW duplicates at ingestion time — this script cleans up rows that
// were already written before that fix.
//
// For each "weak id" row (id does not look like `call_<hex>`, i.e. it came
// from WeeBespoke's own `_id`/`id` fallback) it looks for an existing
// Retell-sourced row (meta->>source = 'retell') for the same phone whose call
// window [started_at, started_at+duration] ends within 90s of the weak row's
// started_at, with a matching duration. On match: merges any booking fields
// from the weak row onto the Retell row, then deletes the weak row.
//
// Usage:
//   node scripts/dedupe-wbah-calls.mjs           # dry run, reports matches only
//   node scripts/dedupe-wbah-calls.mjs --apply   # actually merges + deletes

import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !key) {
  console.error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const BOOKING_FIELDS = ["appointment_date", "appointment_time", "booking_status", "calendly_booking_url"];

function isWeakCallId(id) {
  return !/^call_/.test(String(id));
}

async function main() {
  const { data: weakRows, error: e1 } = await sb
    .from("wbah_calls")
    .select("id, workspace_id, phone, started_at, duration_seconds, appointment_date, appointment_time, booking_status, calendly_booking_url, meta")
    .is("meta->>source", null);
  if (e1) throw new Error(e1.message);

  const candidates = (weakRows ?? []).filter((r) => isWeakCallId(r.id) && r.phone && r.started_at);
  console.log(`Total non-retell rows: ${weakRows.length}, candidates with phone+started_at: ${candidates.length}`);

  // IMPORTANT: PostgREST caps a single response at 1000 rows by default. A
  // chunk of many phones can easily have >1000 combined retell rows (busy
  // numbers dominate), which would silently truncate the result and drop
  // rows for other phones in that chunk with NO error — causing real
  // duplicates to be missed. Query a handful of phones per request and
  // paginate each one with .range() until it's exhausted.
  const phones = Array.from(new Set(candidates.map((r) => r.phone)));
  const CHUNK = 20;
  const PAGE = 1000;
  const retellByPhone = new Map();
  for (let i = 0; i < phones.length; i += CHUNK) {
    const chunk = phones.slice(i, i + CHUNK);
    let from = 0;
    while (true) {
      const { data: retellRows, error: e2 } = await sb
        .from("wbah_calls")
        .select("id, phone, started_at, duration_seconds, appointment_date, appointment_time, booking_status, calendly_booking_url")
        .eq("meta->>source", "retell")
        .in("phone", chunk)
        .range(from, from + PAGE - 1);
      if (e2) throw new Error(e2.message);
      const rows = retellRows ?? [];
      for (const r of rows) {
        const arr = retellByPhone.get(r.phone) ?? [];
        arr.push(r);
        retellByPhone.set(r.phone, arr);
      }
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }

  let matched = 0;
  let unmatched = 0;
  const toDelete = [];
  const bookingUpdates = new Map();

  for (const row of candidates) {
    const rowStart = Date.parse(row.started_at);
    if (!Number.isFinite(rowStart)) { unmatched++; continue; }
    const cands = retellByPhone.get(row.phone) ?? [];
    let match = null;
    for (const c of cands) {
      const cStart = c.started_at ? Date.parse(c.started_at) : NaN;
      if (!Number.isFinite(cStart)) continue;
      const expectedEnd = cStart + (c.duration_seconds ?? 0) * 1000;
      const durationsClose = row.duration_seconds == null || c.duration_seconds == null
        ? true
        : Math.abs(row.duration_seconds - c.duration_seconds) <= 3;
      if (durationsClose && Math.abs(rowStart - expectedEnd) <= 90_000) { match = c; break; }
    }
    if (match) {
      matched++;
      toDelete.push(row.id);
      const patch = {};
      for (const f of BOOKING_FIELDS) {
        const cur = match[f];
        const incoming = row[f];
        if ((cur == null || String(cur).trim() === "") && incoming != null && String(incoming).trim() !== "") {
          patch[f] = incoming;
        }
      }
      if (Object.keys(patch).length) {
        bookingUpdates.set(String(match.id), { ...(bookingUpdates.get(String(match.id)) ?? {}), ...patch });
      }
    } else {
      unmatched++;
    }
  }

  console.log(`Matched (confirmed duplicates of a Retell row): ${matched}`);
  console.log(`Unmatched (left untouched — no confident Retell counterpart): ${unmatched}`);
  console.log(`Booking-field merges required: ${bookingUpdates.size}`);

  if (!APPLY) {
    console.log("\nDry run only — pass --apply to merge booking fields and delete the duplicate rows.");
    return;
  }

  for (const [id, patch] of bookingUpdates) {
    const { error } = await sb.from("wbah_calls").update(patch).eq("id", id);
    if (error) console.error(`booking merge failed for ${id}: ${error.message}`);
  }
  console.log(`Applied ${bookingUpdates.size} booking merges.`);

  const DEL_CHUNK = 200;
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += DEL_CHUNK) {
    const chunk = toDelete.slice(i, i + DEL_CHUNK);
    const { error, count } = await sb.from("wbah_calls").delete({ count: "exact" }).in("id", chunk);
    if (error) console.error(`delete failed for chunk starting ${chunk[0]}: ${error.message}`);
    else deleted += count ?? chunk.length;
  }
  console.log(`Deleted ${deleted} duplicate rows.`);
}

main().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
