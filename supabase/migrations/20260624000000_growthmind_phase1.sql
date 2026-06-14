-- GrowthMind Phase 1: AI CMO Foundation
-- Apply in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS growthmind_recommendations (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID        NOT NULL,
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
  workspace_id UUID        NOT NULL,
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
  workspace_id UUID        NOT NULL,
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

CREATE INDEX IF NOT EXISTS growthmind_recs_ws
  ON growthmind_recommendations (workspace_id, is_dismissed, created_at DESC);

CREATE INDEX IF NOT EXISTS growthmind_tasks_ws_status
  ON growthmind_tasks (workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS growthmind_tasks_dedup
  ON growthmind_tasks (workspace_id, trigger_type, entity_id)
  WHERE status <> 'completed';

CREATE INDEX IF NOT EXISTS growthmind_events_ws_unread
  ON growthmind_events (workspace_id, is_read, created_at DESC);
