-- Server-side Mind conversation persistence (Shared Intelligence Contract).
-- Conversations are per workspace + user + Mind; messages carry role, content,
-- tool refs (mind_tool_executions ids etc.) and created refs (tasks/approvals).
-- Members RLS pattern: reads/writes limited to workspace members via the
-- authenticated context.supabase client; server fns additionally scope by user.

CREATE TABLE IF NOT EXISTS mind_conversations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL,
  user_id           uuid NOT NULL,
  mind              text NOT NULL
                    CHECK (mind IN ('hivemind','growthmind','systemmind','accountsmind')),
  title             text,
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','archived')),
  current_objective text,
  message_count     integer NOT NULL DEFAULT 0,
  last_message_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mconv_ws_user_mind
  ON mind_conversations (workspace_id, user_id, mind, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS mind_conversation_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES mind_conversations(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL,
  user_id         uuid,
  role            text NOT NULL
                  CHECK (role IN ('user','assistant','system','tool')),
  content         text NOT NULL,
  tool_refs       jsonb,
  created_refs    jsonb,
  metadata        jsonb,
  client_msg_id   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcmsg_conv_created
  ON mind_conversation_messages (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_mcmsg_ws_created
  ON mind_conversation_messages (workspace_id, created_at DESC);
-- Idempotent append: a retried client write with the same client id is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mcmsg_conv_client_id
  ON mind_conversation_messages (conversation_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;

ALTER TABLE mind_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE mind_conversation_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "mconv_members" ON mind_conversations
    FOR ALL TO authenticated
    USING (workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    ))
    WITH CHECK (workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "mcmsg_members" ON mind_conversation_messages
    FOR ALL TO authenticated
    USING (workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    ))
    WITH CHECK (workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

REVOKE ALL ON mind_conversations FROM anon;
REVOKE ALL ON mind_conversation_messages FROM anon;
