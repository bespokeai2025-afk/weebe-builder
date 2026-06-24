---
name: data_records list perf & bloat
description: Why the Data Records tab hangs for big workspaces and the index that fixes it.
---

# data_records list perf & bloat

`listDataRecords` orders `data_records` by `updated_at` (desc) filtered by
`workspace_id` + `is_deleted=false`. WBAH's data_records is ~750k rows, and there
was NO index covering that sort — only (workspace_id) and (workspace_id,
mobile_number). So the query full-sorted every workspace row → breached the 8s
authenticated statement timeout → React Query retried → the Records tab stuck at
"Loading records… 99%" with Total 0, never showing freshly imported CSV rows.

**Fix:** index `data_records_ws_deleted_updated_idx` on
`(workspace_id, is_deleted, updated_at DESC)` (built CONCURRENTLY via the Supabase
Management API; recorded in supabase/migrations/DATA_RECORDS_UPDATED_AT_INDEX_MIGRATION.sql).
Query dropped from timeout to ~0.4s. No app code change needed.

**Why the bloat (separate, unfixed):** WBAH's data_records is inflated by the
sync/import dedup pattern — `importDataRecords` and the WBAH CRM/buyer syncs
(wbah.functions.ts, wbah-leads-sync-tick.ts) fetch "existing mobile numbers" with
no bound, so PostgREST silently caps the dedup set at 1000 rows and everything
else re-inserts as "new" on every run. Same class as the leads dedup explosion.
Cleaning the dupes is destructive — get user approval before a resync/cleanup.

**How to apply:** any new high-volume tenant `ORDER BY <col> LIMIT n` over a
workspace-scoped table needs a `(workspace_id, …, <col>)` index or it will time
out under the 8s authenticated limit. Run DDL via Management API + SUPABASE_ACCESS_TOKEN;
CREATE INDEX CONCURRENTLY must be outside a transaction.
