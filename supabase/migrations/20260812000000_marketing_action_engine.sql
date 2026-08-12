-- Marketing Action Engine + autonomy levels & guardrails (Task: foundation).
-- Additive & idempotent. Apply via Supabase Management API.

-- ── 1. Universal MarketingAction record ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_actions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source                TEXT        NOT NULL,                 -- e.g. 'gads_analysis', 'seo_queue', 'hivemind_objective', 'user'
  requested_by          UUID,                                 -- user id where applicable
  objective             TEXT,                                 -- linked objective / reason
  platform              TEXT        NOT NULL,                 -- 'google_ads' | 'seo' | 'website' | ...
  action_type           TEXT        NOT NULL,                 -- platform-specific type e.g. 'gads_budget_change'
  target                JSONB       NOT NULL DEFAULT '{}'::jsonb, -- what is changed (campaign id, keyword, page...)
  existing_value        JSONB,
  proposed_value        JSONB,
  expected_impact       TEXT,
  confidence            NUMERIC(4,3),
  risk_level            TEXT        NOT NULL DEFAULT 'medium',
  approval_required     BOOLEAN     NOT NULL DEFAULT TRUE,
  approval_action_id    UUID,                                 -- linked hivemind_actions row
  status                TEXT        NOT NULL DEFAULT 'discovered',
  execution_attempts    INTEGER     NOT NULL DEFAULT 0,
  external_resource_id  TEXT,
  api_response          JSONB,
  verification_status   TEXT,                                 -- 'pending' | 'verified' | 'failed'
  verification_evidence JSONB,
  rollback_payload      JSONB,
  rollback_of           UUID REFERENCES marketing_actions(id) ON DELETE SET NULL,
  evidence              JSONB       NOT NULL DEFAULT '{}'::jsonb, -- data used to justify the action
  error_message         TEXT,
  status_history        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at           TIMESTAMPTZ,
  verified_at           TIMESTAMPTZ,
  measured_at           TIMESTAMPTZ
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_actions_status_ck') THEN
    ALTER TABLE marketing_actions ADD CONSTRAINT marketing_actions_status_ck CHECK (status IN (
      'discovered','recommended','awaiting_approval','approved','executing',
      'executed','verified','measuring','success','failed','rolled_back'
    ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_actions_risk_ck') THEN
    ALTER TABLE marketing_actions ADD CONSTRAINT marketing_actions_risk_ck CHECK (risk_level IN ('low','medium','high'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS marketing_actions_ws_status_idx
  ON marketing_actions (workspace_id, status);
CREATE INDEX IF NOT EXISTS marketing_actions_ws_created_idx
  ON marketing_actions (workspace_id, created_at DESC);
-- Autopilot daily-cap scan: automated executions today.
CREATE INDEX IF NOT EXISTS marketing_actions_ws_executed_idx
  ON marketing_actions (workspace_id, executed_at)
  WHERE executed_at IS NOT NULL;

-- Stable autopilot reservation timestamp — set once at claim, never mutated,
-- so the daily cap counts every automated attempt (incl. later failures).
ALTER TABLE marketing_actions
  ADD COLUMN IF NOT EXISTS auto_claimed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS marketing_actions_ws_autoclaim_idx
  ON marketing_actions (workspace_id, auto_claimed_at)
  WHERE auto_claimed_at IS NOT NULL;

-- One live compensating action per original — concurrent undo requests race
-- to a unique-violation instead of double-executing.
CREATE UNIQUE INDEX IF NOT EXISTS marketing_actions_one_live_undo_idx
  ON marketing_actions (rollback_of)
  WHERE rollback_of IS NOT NULL AND status <> 'failed';

ALTER TABLE marketing_actions ENABLE ROW LEVEL SECURITY;

GRANT ALL ON marketing_actions TO service_role;

-- Members READ their workspace's actions; ALL writes are server-only
-- (service role). Default grants give authenticated ALL — revoke.
REVOKE INSERT, UPDATE, DELETE ON marketing_actions FROM authenticated;
REVOKE ALL ON marketing_actions FROM anon;

DROP POLICY IF EXISTS marketing_actions_member_read ON marketing_actions;
CREATE POLICY marketing_actions_member_read
  ON marketing_actions FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- ── 2. Marketing autonomy level + guardrails on workspace_settings ──────────
ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS marketing_autonomy_level TEXT  NOT NULL DEFAULT 'recommend',
  ADD COLUMN IF NOT EXISTS marketing_guardrails     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS marketing_autonomy_set_by UUID,
  ADD COLUMN IF NOT EXISTS marketing_autonomy_set_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_settings_marketing_autonomy_ck') THEN
    ALTER TABLE workspace_settings ADD CONSTRAINT workspace_settings_marketing_autonomy_ck
      CHECK (marketing_autonomy_level IN ('observe','recommend','approval','autopilot'));
  END IF;
END $$;
