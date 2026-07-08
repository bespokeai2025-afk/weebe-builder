---
name: WBAH calls weak-id duplicate rows
description: Why WBAH Calls page showed a call twice, and the pagination trap that hides it during cleanup
---

`wbah_calls` is written by two independent syncs: Retell-sourced (authoritative,
`meta.source = 'retell'`, id = Retell's real `call_id`) and a WeeBespoke-history
sync. When a WeeBespoke raw record lacks `call_id`, the row builder falls back
to WeeBespoke's own internal `_id`, AND its `started_at` fallback lands near
the call's END time, not its start. Unless deduped before insert, this creates
a second row for a call Retell already synced — shows up to users as the same
call listed twice (looking like separate "start" and "end" entries).

**Why:** two independent writers into the same table with different id
schemes will drift unless one explicitly reconciles against the other before
writing.

**How to apply:** any code inserting into `wbah_calls` from a non-Retell
source must first check for an existing `meta->>source = 'retell'` row for the
same phone whose call window (`started_at + duration`) ends within ~90s of the
candidate's `started_at` (see `dedupeAgainstRetellRows()` in
`wbah-leads-sync-tick.ts`). Merge booking fields onto the existing row and
skip the insert rather than creating a duplicate. Same principle applies to
any other table with more than one write path keyed by different id schemes.

**Pagination trap when auditing/cleaning by phone across many rows:**
PostgREST caps a single response at 1000 rows. A batched
`.in('phone', manyPhones)` query with no `.range()` pagination silently
truncates when a few busy phones dominate the row count — rows for other
phones in that same batch get dropped with no error, which looks exactly like
"no duplicate found" and causes a dedup/cleanup script to under-match. Always
paginate per batch (small batches, e.g. ~20 keys, with `.range()` loop) rather
than trusting one unpaginated `.in()` call to return everything.
