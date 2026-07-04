-- =====================================================================
-- UNIFIED SYNC STATE
-- Per-workspace, per-module sync-state tracking so each workspace can see
-- when a data source was last synced, whether it succeeded, and how many
-- records were created / updated / skipped.
--
-- STRICTLY ADDITIVE + BACKWARDS COMPATIBLE:
--   • No existing table or behaviour is changed.
--   • Rows are written ONLY by the existing on-demand / manual sync paths.
--   • This does NOT introduce any automatic or background sync — it only
--     records the outcome of syncs that already run today.
--
-- Apply in Supabase SQL Editor.
-- =====================================================================

CREATE TABLE IF NOT EXISTS sync_state (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid NOT NULL,
  source_name              text NOT NULL,          -- e.g. 'webespoke_enterprise'
  module                   text NOT NULL,          -- e.g. 'calls' | 'leads' | 'contacts' | 'people' | 'analytics'
  last_successful_sync_at  timestamptz,
  last_attempted_sync_at   timestamptz,
  last_cursor              text,
  last_external_updated_at timestamptz,
  sync_status              text DEFAULT 'idle',     -- 'idle' | 'running' | 'success' | 'partial' | 'error'
  error_message            text,
  records_created          integer DEFAULT 0,
  records_updated          integer DEFAULT 0,
  records_skipped          integer DEFAULT 0,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);

-- One row per (workspace, source, module) — upserts key on this.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_state_ws_source_module
  ON sync_state (workspace_id, source_name, module);

CREATE INDEX IF NOT EXISTS idx_sync_state_workspace
  ON sync_state (workspace_id);

ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;

-- Workspace members may read their own workspace's sync state. Writes happen
-- through the service-role client (bypasses RLS), so SELECT-only is sufficient.
DROP POLICY IF EXISTS "workspace members can view sync_state" ON sync_state;
CREATE POLICY "workspace members can view sync_state"
  ON sync_state FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
