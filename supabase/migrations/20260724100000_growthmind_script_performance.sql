-- GrowthMind call-script performance intelligence.
-- growthmind_script_analysis: one cached analysis snapshot per workspace run.
-- Server-write-only (service role / server fns); workspace members may read.

CREATE TABLE IF NOT EXISTS growthmind_script_analysis (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  period_start  timestamptz NOT NULL,
  period_end    timestamptz NOT NULL,
  source        text NOT NULL CHECK (source IN ('standard','wbah')),
  metrics       jsonb NOT NULL DEFAULT '{}'::jsonb,
  patterns      jsonb NOT NULL DEFAULT '{}'::jsonb,
  sample_size   integer NOT NULL DEFAULT 0,
  analyzed_transcripts integer NOT NULL DEFAULT 0,
  ai_status     text NOT NULL DEFAULT 'skipped' CHECK (ai_status IN ('ok','skipped','failed')),
  computed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_script_analysis_ws_computed
  ON growthmind_script_analysis (workspace_id, computed_at DESC);

ALTER TABLE growthmind_script_analysis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gm_script_analysis_member_read ON growthmind_script_analysis;
CREATE POLICY gm_script_analysis_member_read
  ON growthmind_script_analysis FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- Server-write-only: default grants would give authenticated ALL.
REVOKE INSERT, UPDATE, DELETE ON growthmind_script_analysis FROM authenticated;
REVOKE ALL ON growthmind_script_analysis FROM anon;
