-- Mind tool execution audit trail (Shared Intelligence Contract).
-- Every consequential Mind tool execution (web / mobile / api) records
-- workspace, user, platform, mind, tool, scrubbed parameters, approval ref,
-- affected record, previous/new state and real status transitions.
-- Server-write-only: members may SELECT their workspace rows.

CREATE TABLE IF NOT EXISTS mind_tool_executions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL,
  user_id               uuid,
  platform              text NOT NULL DEFAULT 'web'
                        CHECK (platform IN ('web','mobile','api','system')),
  mind                  text NOT NULL
                        CHECK (mind IN ('hivemind','growthmind','systemmind','accountsmind')),
  tool_name             text NOT NULL,
  initiated_by          text NOT NULL DEFAULT 'user'
                        CHECK (initiated_by IN ('user','mind')),
  status                text NOT NULL
                        CHECK (status IN ('proposed','approval_required','queued','running','completed','failed','blocked')),
  parameters            jsonb,
  approval_ref          text,
  affected_record_type  text,
  affected_record_id    text,
  previous_state        jsonb,
  new_state             jsonb,
  result_summary        jsonb,
  error_message         text,
  estimated_cost        text,
  started_at            timestamptz,
  finished_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mte_ws_created
  ON mind_tool_executions (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mte_ws_tool
  ON mind_tool_executions (workspace_id, tool_name, created_at DESC);

ALTER TABLE mind_tool_executions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "mte_select_members" ON mind_tool_executions
    FOR SELECT TO authenticated
    USING (workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

REVOKE INSERT, UPDATE, DELETE ON mind_tool_executions FROM authenticated;
REVOKE ALL ON mind_tool_executions FROM anon;
