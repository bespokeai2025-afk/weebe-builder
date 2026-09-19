-- Index required for "Leads Created Over Time" (Phase 2B.2) and any future
-- volume-over-time analytics that filter/aggregate leads by created_at.
--
-- Note: an index of the same name already exists, bundled inside
-- 20261006000000_lead_status_events.sql (workspace_id, created_at — no
-- explicit order), which is deliberately NOT applied yet (separate,
-- not-yet-approved analytics-history change). This migration extracts an
-- equivalent index into its own minimal, independent file so it can ship
-- now without depending on that one. Both use CREATE INDEX IF NOT EXISTS
-- under the same name, so if the other migration is ever applied later,
-- it will simply no-op against whichever of the two ran first — harmless,
-- and functionally equivalent either way (a B-tree index scans efficiently
-- in both directions). This one uses DESC to match this project's existing
-- convention on similar tables (e.g. calls_started_at_idx, idx_calls_ws_created).

CREATE INDEX IF NOT EXISTS idx_leads_ws_created_at
  ON public.leads (workspace_id, created_at DESC);
