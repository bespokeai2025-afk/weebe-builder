---
name: WBAH People tabs = need-to-be-called, split 3 ways
description: All three WBAH People sub-tabs (Disqualified / Tried-To-Contact / Rebooking) are mutually-exclusive buckets of the not-yet-booked contacts, derived live from wbah_calls — not the lead/CRM APIs, not wbah_categorized_leads.
---

# WBAH People tabs = "need to be called", split into 3 mutually-exclusive buckets

The WBAH People sub-tabs partition the **"need to be called"** set (every contact
NOT booked, `booking_status <> 'success'`, deduped to one row per contact by latest
call `started_at desc`) into THREE mutually-exclusive buckets — each contact appears
in exactly one tab. All derived live from `wbah_calls` (see
`classifyWbahNeedCall` + `getWbahCallDerivedContacts` in wbah-workspace.server.ts).

**Bucket rules (first match wins — ORDER MATTERS):**
1. **Disqualified** — `sentiment = 'negative'`, or not-interested/reject/unsuitable/
   do-not-call/disqualif text in disconnection/end reason. (reached, dead lead)
2. **Rebooking** — has an `appointment_date`, or rebook/reschedule/call-back/
   call-later/callback/pending text. (had/needs an appointment to redo)
3. **Tried To Contact** — `call_status` no_answer/not_connected/voicemail, or
   voicemail/no_input/dial_* reason, or (no sentiment AND not completed). (never reached)
4. **Default → Rebooking** — reached (completed), neutral/positive, no booking yet
   → call back to land a booking.

Verified live distribution (of ~3,298 not-booked): tried_to_contact ≈ 2,534,
rebooking ≈ 694, disqualified ≈ 70 (sums to the full not-booked set).
**Why these defaults:** the codebase's own `classifyLead` (wbah-category-sync.ts)
already encoded this intent; we just reuse it against the clean `wbah_calls` source.
Boundaries (esp. where null-sentiment / neutral-completed land) are a judgment call —
if the user disputes the sizes, tweak the order/conditions in `classifyWbahNeedCall`.

**Why this source (not the obvious ones):**
- No WeeBespoke API exposes a per-lead "Disqualified" / "Need to Call" status.
- The `leads` table is unusable for this: it's massively duplicated AND its
  `meta.call_status` is uniformly `'ended'` for every row, so it carries no
  need-to-call signal at all.
- `wbah_calls` (synced every 5 min) is the only clean per-contact source with the
  rich fields the source app shows. The source BeSpoke People page's "Need to Call"
  KPI was ~96% of all contacts = everyone-not-booked, which is the definition used.

**Performance (the dataset is ~3.3k contacts, was 126 when negative-only):**
- The fetch-all + dedup + not-booked filter is range-paginated (1000/page loop —
  PostgREST caps a single select at 1000 rows) and wrapped in `cacheWrap` (60s) per
  workspace, returning a LIGHTWEIGHT set (no transcript). Search + pagination run
  after the cache; transcripts are fetched only for the current page's IDs.
- The UI eager-loads only a COUNT on People-tab open (server fn with `limit:1`, read
  `.total`), mirroring the Calls-tab count pattern; the full ~3.3k rows lazy-load
  only when the Disqualified sub-tab is opened (client-side search/filters need the
  full set). KPI/badge/"N total" use `wbahDqData.length || wbahDqCount`.

**How to apply:** Counts grow live — don't expect to match old static screenshots.
If you ever need a true booked-ever exclusion (vs latest-call booking_status), that
requires per-contact aggregation; current code judges by the latest call, which is
fine at this scale (only ~25 booked).
