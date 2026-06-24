-- Data Records list performance index
--
-- listDataRecords (src/lib/dashboard/data-records.functions.ts) reads:
--   from("data_records")
--     .eq("workspace_id", ws).eq("is_deleted", false)
--     .order("updated_at", { ascending: false }).limit(N)
--
-- Without an index covering (workspace_id, is_deleted, updated_at) Postgres has
-- to fetch every workspace row and sort it. For high-volume workspaces such as
-- WeBuyAnyHouse (~750k data_records) that sort breaches the 8s statement timeout,
-- so the Data Records tab hangs at "Loading records… 99%" and never renders the
-- rows that were just imported via CSV.
--
-- CREATE INDEX CONCURRENTLY must run OUTSIDE a transaction block. If your SQL
-- runner wraps statements in a transaction, drop the CONCURRENTLY keyword (the
-- brief write lock is acceptable on this background-written table).

CREATE INDEX CONCURRENTLY IF NOT EXISTS data_records_ws_deleted_updated_idx
  ON public.data_records (workspace_id, is_deleted, updated_at DESC);
