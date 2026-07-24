-- Tighten Mind conversation RLS to per-user ownership (architect review fix).
-- These chats are private to the individual user, not the whole workspace:
-- other workspace members must not be able to read or write them directly.
-- Also enforce a single active conversation per (workspace, user, mind).

DROP POLICY IF EXISTS "mconv_members" ON mind_conversations;
DROP POLICY IF EXISTS "mcmsg_members" ON mind_conversation_messages;

DO $$ BEGIN
  CREATE POLICY "mconv_owner" ON mind_conversations
    FOR ALL TO authenticated
    USING (
      user_id = auth.uid()
      AND workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
      )
    )
    WITH CHECK (
      user_id = auth.uid()
      AND workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "mcmsg_owner" ON mind_conversation_messages
    FOR ALL TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM mind_conversations c
        WHERE c.id = mind_conversation_messages.conversation_id
          AND c.user_id = auth.uid()
          AND c.workspace_id = mind_conversation_messages.workspace_id
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM mind_conversations c
        WHERE c.id = mind_conversation_messages.conversation_id
          AND c.user_id = auth.uid()
          AND c.workspace_id = mind_conversation_messages.workspace_id
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One active conversation per (workspace, user, mind); concurrent first-loads
-- hit 23505 and re-select instead of creating duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mconv_active
  ON mind_conversations (workspace_id, user_id, mind)
  WHERE status = 'active';
