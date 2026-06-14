-- GrowthMind Phase 3: Goals & Tracking table
-- Apply in Supabase SQL Editor

-- ── Table ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS growthmind_goals (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  metric       TEXT        NOT NULL
                           CHECK (metric IN ('leads','bookings','sales','call_success_rate','calls_made')),
  label        TEXT        NOT NULL,
  target       NUMERIC     NOT NULL CHECK (target > 0),
  deadline     DATE        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Index ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS gm_goals_workspace_idx
  ON growthmind_goals (workspace_id, created_at DESC);

-- ── Row Level Security ────────────────────────────────────────────────────────────

ALTER TABLE growthmind_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gm_goals_select" ON growthmind_goals FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

CREATE POLICY "gm_goals_insert" ON growthmind_goals FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

CREATE POLICY "gm_goals_update" ON growthmind_goals FOR UPDATE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

CREATE POLICY "gm_goals_delete" ON growthmind_goals FOR DELETE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
