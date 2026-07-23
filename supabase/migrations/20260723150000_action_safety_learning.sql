-- Task: Approval modes, action safety & learning loop.
-- Additive & idempotent. Apply via Supabase Management API
-- (scripts/apply-action-safety-migration.mjs).

-- ── 1. Mode defaults + operator enablement ────────────────────────────────────
-- Default HiveMind mode becomes "recommend" (spec). Existing rows keep their
-- explicitly stored value; only NEW workspaces get the safer default.
ALTER TABLE workspace_settings
  ALTER COLUMN hivemind_mode SET DEFAULT 'recommend';

ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS hivemind_operator_enabled     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hivemind_operator_permissions JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS hivemind_operator_enabled_by  UUID,
  ADD COLUMN IF NOT EXISTS hivemind_operator_enabled_at  TIMESTAMPTZ;

-- ── 2. hivemind_actions — audit + learning columns ───────────────────────────
ALTER TABLE hivemind_actions
  ADD COLUMN IF NOT EXISTS authorised_by_user_id    UUID,
  ADD COLUMN IF NOT EXISTS sensitive                BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sensitive_category       TEXT,
  ADD COLUMN IF NOT EXISTS consumed_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS previous_state           JSONB,
  ADD COLUMN IF NOT EXISTS new_state                JSONB,
  ADD COLUMN IF NOT EXISTS rollback_info            JSONB,
  ADD COLUMN IF NOT EXISTS source_recommendation_id UUID,
  ADD COLUMN IF NOT EXISTS baseline                 JSONB,
  ADD COLUMN IF NOT EXISTS expected_result          TEXT,
  ADD COLUMN IF NOT EXISTS reassess_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outcome                  JSONB,
  ADD COLUMN IF NOT EXISTS outcome_classification   TEXT;

-- Classification vocabulary (idempotent constraint add).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hivemind_actions_outcome_class_ck'
  ) THEN
    ALTER TABLE hivemind_actions
      ADD CONSTRAINT hivemind_actions_outcome_class_ck
      CHECK (outcome_classification IS NULL OR outcome_classification IN
        ('successful','partial','no_change','unsuccessful','inconclusive'));
  END IF;
END $$;

-- Reassessment scan index: executed actions awaiting outcome classification.
CREATE INDEX IF NOT EXISTS hivemind_actions_reassess_idx
  ON hivemind_actions (reassess_at)
  WHERE reassess_at IS NOT NULL AND status = 'executed' AND outcome_classification IS NULL;

-- ── 3. Learning loop — confidence adjustments per recommendation/action type ─
CREATE TABLE IF NOT EXISTS hivemind_confidence_adjustments (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  adjustment_key TEXT        NOT NULL,           -- e.g. 'action:create_task' or 'rec:growth'
  successes      INTEGER     NOT NULL DEFAULT 0,
  partials       INTEGER     NOT NULL DEFAULT 0,
  failures       INTEGER     NOT NULL DEFAULT 0,
  inconclusive   INTEGER     NOT NULL DEFAULT 0,
  adjustment     NUMERIC(4,3) NOT NULL DEFAULT 0, -- confidence delta in [-0.3, +0.3]
  last_outcome   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS hivemind_confidence_adjustments_uq
  ON hivemind_confidence_adjustments (workspace_id, adjustment_key);

ALTER TABLE hivemind_confidence_adjustments ENABLE ROW LEVEL SECURITY;

-- Members can READ their workspace's learning stats; all writes are
-- server-only (service role). Default grants give authenticated ALL — revoke.
REVOKE INSERT, UPDATE, DELETE ON hivemind_confidence_adjustments FROM authenticated;
REVOKE ALL ON hivemind_confidence_adjustments FROM anon;

DROP POLICY IF EXISTS hivemind_confidence_adjustments_member_read ON hivemind_confidence_adjustments;
CREATE POLICY hivemind_confidence_adjustments_member_read
  ON hivemind_confidence_adjustments FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- Learning-loop bridge feedback on recommendations
ALTER TABLE hivemind_recommendations
  ADD COLUMN IF NOT EXISTS outcome_note TEXT;
