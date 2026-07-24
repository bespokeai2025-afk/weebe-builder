-- Executive Operator mode + cross-Mind orchestration runs.
-- 1) Extend the hivemind_mode CHECK constraint with 'executive_operator'.
-- 2) hivemind_orchestration_runs: one row per orchestration playbook run,
--    linking a coordinated recommendation to its created hivemind_tasks.
--    Server-write-only (service role); workspace members may read.

ALTER TABLE workspace_settings
  DROP CONSTRAINT IF EXISTS workspace_settings_hivemind_mode_check;
ALTER TABLE workspace_settings
  ADD CONSTRAINT workspace_settings_hivemind_mode_check
  CHECK (hivemind_mode IN ('observe','recommend','assistant','operator','executive_operator'));

CREATE TABLE IF NOT EXISTS hivemind_orchestration_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL,
  playbook       text NOT NULL CHECK (playbook IN ('campaign_underperforming','invoice_missing','lead_not_followed_up')),
  trigger_source text NOT NULL DEFAULT 'manual' CHECK (trigger_source IN ('manual','auto')),
  status         text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','no_findings','failed')),
  entity_type    text,
  entity_id      text,
  recommendation text,
  analyses       jsonb NOT NULL DEFAULT '{}'::jsonb,
  task_ids       jsonb NOT NULL DEFAULT '[]'::jsonb,
  escalations    jsonb NOT NULL DEFAULT '[]'::jsonb,
  error          text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hm_orch_runs_ws_created
  ON hivemind_orchestration_runs (workspace_id, created_at DESC);

ALTER TABLE hivemind_orchestration_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hm_orch_runs_member_read ON hivemind_orchestration_runs;
CREATE POLICY hm_orch_runs_member_read
  ON hivemind_orchestration_runs FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- Server-write-only: default grants would give authenticated ALL.
REVOKE INSERT, UPDATE, DELETE ON hivemind_orchestration_runs FROM authenticated;
REVOKE ALL ON hivemind_orchestration_runs FROM anon;
