-- HiveMind Phase 3: Tasks + Events
-- Apply in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS hivemind_tasks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL,
  title        TEXT        NOT NULL,
  description  TEXT,
  status       TEXT        NOT NULL DEFAULT 'suggested'
                           CHECK (status IN ('suggested','approved','in_progress','completed')),
  priority     TEXT        NOT NULL DEFAULT 'medium'
                           CHECK (priority IN ('low','medium','high','critical')),
  assigned_to  TEXT,
  due_date     DATE,
  source       TEXT        NOT NULL DEFAULT 'ai_scan',
  trigger_type TEXT,
  entity_type  TEXT,
  entity_id    TEXT,
  entity_name  TEXT,
  comments     JSONB       NOT NULL DEFAULT '[]',
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hivemind_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL,
  event_type   TEXT        NOT NULL,
  severity     TEXT        NOT NULL DEFAULT 'info'
                           CHECK (severity IN ('info','warning','critical')),
  title        TEXT        NOT NULL,
  description  TEXT,
  entity_type  TEXT,
  entity_id    TEXT,
  entity_name  TEXT,
  task_id      UUID        REFERENCES hivemind_tasks(id) ON DELETE SET NULL,
  is_read      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hivemind_tasks_ws_status
  ON hivemind_tasks (workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS hivemind_tasks_dedup
  ON hivemind_tasks (workspace_id, trigger_type, entity_id)
  WHERE status <> 'completed';

CREATE INDEX IF NOT EXISTS hivemind_events_ws_unread
  ON hivemind_events (workspace_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS hivemind_events_dedup
  ON hivemind_events (workspace_id, event_type, entity_id, created_at DESC);
