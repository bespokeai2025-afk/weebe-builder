-- HiveMind Phase 4: Mode system + Action Approval Centre
-- Apply in Supabase SQL Editor

ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS hivemind_mode TEXT NOT NULL DEFAULT 'assistant'
  CHECK (hivemind_mode IN ('observe','recommend','assistant','operator'));

CREATE TABLE IF NOT EXISTS hivemind_actions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID        NOT NULL,
  title          TEXT        NOT NULL,
  description    TEXT,
  action_type    TEXT        NOT NULL,
  action_payload JSONB       NOT NULL DEFAULT '{}',
  status         TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','approved','rejected','executed','failed')),
  proposed_by    TEXT        NOT NULL DEFAULT 'hivemind',
  approved_by    TEXT,
  result         JSONB,
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS hivemind_actions_ws_status
  ON hivemind_actions (workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS hivemind_actions_type
  ON hivemind_actions (workspace_id, action_type, status);
