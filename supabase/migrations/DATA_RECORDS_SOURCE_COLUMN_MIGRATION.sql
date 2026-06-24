-- Data Records "source" origin tagging
--
-- The data_records table is written by two paths:
--   1. Manual CSV uploads (importDataRecords) — the call lists users build for
--      the AI agents created in our system.
--   2. WBAH CRM / lead syncs (wbah.functions.ts, wbah-leads-sync-tick.ts) — these
--      mirror the customer's external CRM so the standard Smart Dash pages
--      (Contacts, Leads, ...) work. They are NOT meant to appear in the Records tab.
--
-- The Records tab should be a blank canvas that only fills up when the user
-- uploads a CSV. We distinguish the two with a nullable `source` column:
--   - CSV uploads are tagged source = 'csv' (set in importDataRecords).
--   - Every pre-existing row (incl. the ~750k synced WBAH rows) stays NULL and is
--     therefore hidden from the Records tab's csvOnly filter.
--   - Sync inserts are left untouched; NULL source keeps them out of the tab.
--
-- The composite index keeps the rare source = 'csv' lookup fast even when a
-- workspace has hundreds of thousands of synced rows (otherwise the planner walks
-- the whole (workspace_id, is_deleted, updated_at) index filtering on source).
--
-- CREATE INDEX CONCURRENTLY must run OUTSIDE a transaction block.

ALTER TABLE public.data_records ADD COLUMN IF NOT EXISTS source text;

CREATE INDEX CONCURRENTLY IF NOT EXISTS data_records_ws_deleted_source_updated_idx
  ON public.data_records (workspace_id, is_deleted, source, updated_at DESC);
