-- GrowthMind Phase 1: AI CMO Foundation
-- Apply in Supabase SQL Editor

-- ── Tables ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS growthmind_recommendations (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category       TEXT        NOT NULL,
  priority       TEXT        NOT NULL DEFAULT 'medium'
                             CHECK (priority IN ('low','medium','high','critical')),
  problem        TEXT        NOT NULL,
  impact         TEXT,
  fix            TEXT,
  action_href    TEXT,
  action_label   TEXT,
  is_dismissed   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  refreshed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS growthmind_tasks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL,
  description  TEXT,
  status       TEXT        NOT NULL DEFAULT 'suggested'
                           CHECK (status IN ('suggested','approved','in_progress','completed')),
  priority     TEXT        NOT NULL DEFAULT 'medium'
                           CHECK (priority IN ('low','medium','high','critical')),
  source       TEXT        NOT NULL DEFAULT 'ai_scan',
  trigger_type TEXT,
  entity_type  TEXT,
  entity_id    TEXT,
  entity_name  TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS growthmind_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type   TEXT        NOT NULL,
  severity     TEXT        NOT NULL DEFAULT 'info'
                           CHECK (severity IN ('info','warning','critical')),
  title        TEXT        NOT NULL,
  description  TEXT,
  entity_type  TEXT,
  entity_id    TEXT,
  entity_name  TEXT,
  task_id      UUID        REFERENCES growthmind_tasks(id) ON DELETE SET NULL,
  is_read      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS growthmind_recs_ws
  ON growthmind_recommendations (workspace_id, is_dismissed, refreshed_at DESC);

CREATE INDEX IF NOT EXISTS growthmind_tasks_ws_status
  ON growthmind_tasks (workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS growthmind_tasks_dedup
  ON growthmind_tasks (workspace_id, trigger_type, entity_id)
  WHERE status <> 'completed';

CREATE INDEX IF NOT EXISTS growthmind_events_ws_unread
  ON growthmind_events (workspace_id, is_read, created_at DESC);

-- ── Row Level Security ─────────────────────────────────────────────────────────

ALTER TABLE growthmind_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_tasks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_events          ENABLE ROW LEVEL SECURITY;

-- growthmind_recommendations: workspace members can read/write their own workspace
CREATE POLICY "growthmind_recs_select"
  ON growthmind_recommendations FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "growthmind_recs_insert"
  ON growthmind_recommendations FOR INSERT
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "growthmind_recs_update"
  ON growthmind_recommendations FOR UPDATE
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "growthmind_recs_delete"
  ON growthmind_recommendations FOR DELETE
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );

-- growthmind_tasks: workspace members can read/write their own workspace
CREATE POLICY "growthmind_tasks_select"
  ON growthmind_tasks FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "growthmind_tasks_insert"
  ON growthmind_tasks FOR INSERT
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "growthmind_tasks_update"
  ON growthmind_tasks FOR UPDATE
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "growthmind_tasks_delete"
  ON growthmind_tasks FOR DELETE
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );

-- growthmind_events: workspace members can read/write their own workspace
CREATE POLICY "growthmind_events_select"
  ON growthmind_events FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "growthmind_events_insert"
  ON growthmind_events FOR INSERT
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "growthmind_events_update"
  ON growthmind_events FOR UPDATE
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );
