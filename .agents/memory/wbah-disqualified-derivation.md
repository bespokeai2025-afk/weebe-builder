---
name: WBAH Disqualified tab = "need to be called"
description: The WBAH People → Disqualified tab lists clients that still need to be called (everyone not yet booked), derived from wbah_calls — not negatives only, not the lead/CRM APIs.
---

# WBAH Disqualified tab = "need to be called"

The WBAH People → **Disqualified** sub-tab + KPI list **clients that still need to
be called** — i.e. every contact who has NOT booked an appointment
(`booking_status <> 'success'`), deduplicated to one row per contact (their
most-recent call, `order by started_at desc`). Negative-sentiment leads are just a
subset. Derived live from the `wbah_calls` table. ~3,298 of 3,323 contacts qualify
(only ~25 are booked). tried_to_contact / rebooking still read
`wbah_categorized_leads`.

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
