---
name: Data Records tab = CSV-only via source column
description: How the Records tab stays a blank canvas showing only CSV uploads, not synced CRM data.
---

# Data Records tab = CSV-only

`data_records` is multi-source: manual CSV uploads (importDataRecords) AND WBAH
CRM/lead syncs (wbah.functions.ts, wbah-leads-sync-tick.ts) write to the same
table. The syncs do this on purpose so Contacts/Leads/standard Smart Dash pages
work — but the Records tab must show ONLY what the user uploads via CSV (a blank
canvas until they upload).

**Decision:** distinguish origin with a nullable `source` text column.
- CSV uploads are tagged `source='csv'` (importDataRecords payload).
- Every pre-existing/synced row stays `NULL` and is hidden — no backfill, no delete.
- `listDataRecords` has an opt-in `csvOnly` param → `.eq('source','csv')`. ONLY the
  Records tab (data.tsx) and its login prefetch pass it. Contacts page calls
  listDataRecords WITHOUT csvOnly, so it still sees synced rows.
- importDataRecords dedup is scoped to `source='csv'` — otherwise a synced row with
  a matching phone number would silently suppress the upload (and it would never
  appear in the csv-only tab). This also sidesteps the 1000-row dedup cap since the
  csv set is tiny.

**Why:** People tab is WBAH-specific and untouched; Contacts depends on synced
data; only the Records tab needed the clean slate.

**How to apply:** Records tab queryKey is `["data-records", filters]` and `filters`
already carries `{limit:500}` which MATCHED the login prefetch key — so `csvOnly`
MUST live inside that `filters` object (and the prefetch updated to match) or you
hit the prefetch stale-data trap. Needs index
`(workspace_id, is_deleted, source, updated_at DESC)` or the rare `source='csv'`
ORDER BY updated_at re-scans the whole big table. Import success invalidates
`["data-records"]` so uploads show immediately.
