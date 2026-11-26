-- HiveMind Executive OS — Stage 2: executive reasoning storage.
-- Additive & idempotent. Apply via
-- scripts/apply-executive-reasoning-migration.mjs (Supabase Management API).

-- ── Executive recommendations (full spec record shape, 13 lifecycle states) ──
CREATE TABLE IF NOT EXISTS hivemind_recommendations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title             TEXT        NOT NULL,
  department        TEXT        NOT NULL DEFAULT 'operations'
                                CHECK (department IN ('growth','system','accounts','crm','operations','cross_department')),
  priority          TEXT        NOT NULL DEFAULT 'medium'
                                CHECK (priority IN ('critical','high','medium','low')),
  business_issue    TEXT        NOT NULL,
  evidence          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  related_entities  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  commercial_impact TEXT,
  risk_of_inaction  TEXT,
  recommended_action TEXT       NOT NULL,
  next_step         TEXT,
  suggested_owner   TEXT,
  due_date          TIMESTAMPTZ,
  approval_required BOOLEAN     NOT NULL DEFAULT TRUE,
  confidence        NUMERIC(4,3) NOT NULL DEFAULT 0.5
                                CHECK (confidence > 0 AND confidence <= 1),
  data_freshness    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  source_systems    TEXT[]      NOT NULL DEFAULT '{}',
  source_event_ids  UUID[]      NOT NULL DEFAULT '{}',
  correlation_key   TEXT,
  dedupe_key        TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'new'
                                CHECK (status IN (
                                  'new','acknowledged','under_review','approved','rejected',
                                  'assigned','in_progress','waiting','completed','failed',
                                  'dismissed','expired','reopened')),
  result            TEXT,
  source            TEXT        NOT NULL DEFAULT 'executive_reasoning',
  reassess_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hard dedup: one live recommendation per (workspace, dedupe_key).
CREATE UNIQUE INDEX IF NOT EXISTS hivemind_recommendations_dedupe_uq
  ON hivemind_recommendations (workspace_id, dedupe_key);

CREATE INDEX IF NOT EXISTS hivemind_recommendations_ws_recent
  ON hivemind_recommendations (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS hivemind_recommendations_ws_status
  ON hivemind_recommendations (workspace_id, status);

CREATE INDEX IF NOT EXISTS hivemind_recommendations_reassess
  ON hivemind_recommendations (reassess_at)
  WHERE reassess_at IS NOT NULL AND status IN ('new','acknowledged','under_review');

ALTER TABLE hivemind_recommendations ENABLE ROW LEVEL SECURITY;

-- Members read their workspace's recommendations. Members may update
-- lifecycle fields (status/result/owner) on their own workspace rows.
-- Inserts/deletes are server-only (service role bypasses RLS).
DO $$ BEGIN
  CREATE POLICY "hm_recs_select" ON hivemind_recommendations
    FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "hm_recs_update" ON hivemind_recommendations
    FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
    WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

REVOKE INSERT, DELETE ON hivemind_recommendations FROM authenticated;
REVOKE ALL ON hivemind_recommendations FROM anon;

-- ── hivemind_tasks accountability extension (additive columns only) ──────────
ALTER TABLE hivemind_tasks ADD COLUMN IF NOT EXISTS department          TEXT;
ALTER TABLE hivemind_tasks ADD COLUMN IF NOT EXISTS reason              TEXT;
ALTER TABLE hivemind_tasks ADD COLUMN IF NOT EXISTS evidence            JSONB;
ALTER TABLE hivemind_tasks ADD COLUMN IF NOT EXISTS dependencies        JSONB;
ALTER TABLE hivemind_tasks ADD COLUMN IF NOT EXISTS reassess_at         TIMESTAMPTZ;
ALTER TABLE hivemind_tasks ADD COLUMN IF NOT EXISTS completion_evidence JSONB;
ALTER TABLE hivemind_tasks ADD COLUMN IF NOT EXISTS escalated_at        TIMESTAMPTZ;
ALTER TABLE hivemind_tasks ADD COLUMN IF NOT EXISTS reopened_count      INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS hivemind_tasks_reassess
  ON hivemind_tasks (reassess_at)
  WHERE reassess_at IS NOT NULL AND status = 'completed';

CREATE INDEX IF NOT EXISTS hivemind_tasks_ws_status_due
  ON hivemind_tasks (workspace_id, status, due_date);
