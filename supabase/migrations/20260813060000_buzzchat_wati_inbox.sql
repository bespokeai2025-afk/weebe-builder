-- BuzzChat WATI inbox: webhook health, conversation identity, media metadata,
-- and per-conversation state (assignment, chat status, tags, unread counts).

-- ============================================================
-- 1. Webhook delivery health
-- ============================================================
-- wati_connections.webhook_manual is self-attested (set by clicking "Confirm manual setup") and
-- proves nothing. Stamping the last event actually received lets the UI tell the difference
-- between "configured" and "delivering".

ALTER TABLE public.wati_connections
  ADD COLUMN IF NOT EXISTS last_webhook_event_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_webhook_event_type TEXT;

-- ============================================================
-- 2. Conversation identity + media metadata on messages
-- ============================================================
-- sentMessageREPLIED_v2 carries conversationId/ticketId but no waId, so storing these on the
-- outbound row lets an inbound reply be matched locally instead of via an extra API round-trip.

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS conversation_id   TEXT,
  ADD COLUMN IF NOT EXISTS ticket_id         TEXT,
  ADD COLUMN IF NOT EXISTS reply_context_id  TEXT,
  ADD COLUMN IF NOT EXISTS media_mime_type   TEXT,
  ADD COLUMN IF NOT EXISTS media_filename    TEXT,
  -- Raw WATI status string (e.g. "REPLIED"), which has no message_status enum equivalent.
  ADD COLUMN IF NOT EXISTS wati_status       TEXT;

CREATE INDEX IF NOT EXISTS whatsapp_messages_conversation_idx
  ON public.whatsapp_messages (workspace_id, conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS whatsapp_messages_ticket_idx
  ON public.whatsapp_messages (workspace_id, ticket_id)
  WHERE ticket_id IS NOT NULL;

-- ============================================================
-- 3. Teams (WATI parity — a conversation may be assigned to a team or an operator)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_teams (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_teams_workspace_name_uniq UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS whatsapp_teams_workspace_idx
  ON public.whatsapp_teams (workspace_id);

CREATE TABLE IF NOT EXISTS public.whatsapp_team_members (
  team_id    UUID        NOT NULL REFERENCES public.whatsapp_teams(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS whatsapp_team_members_user_idx
  ON public.whatsapp_team_members (user_id);

-- ============================================================
-- 4. Per-conversation state
-- ============================================================
-- Threads were previously derived by grouping messages on contact_phone at request time, so
-- there was nowhere to persist assignment, chat status, tags or a real unread count.

CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_phone        TEXT        NOT NULL,
  contact_name         TEXT,
  wati_conversation_id TEXT,
  wati_ticket_id       TEXT,
  status               TEXT        NOT NULL DEFAULT 'open',
  assignee_id          UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_team_id     UUID        REFERENCES public.whatsapp_teams(id) ON DELETE SET NULL,
  tags                 TEXT[]      NOT NULL DEFAULT '{}',
  attributes           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  last_message_at      TIMESTAMPTZ,
  last_direction       TEXT,
  last_message_preview TEXT,
  unread_count         INTEGER     NOT NULL DEFAULT 0,
  last_read_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_conversations_workspace_phone_uniq UNIQUE (workspace_id, contact_phone),
  CONSTRAINT whatsapp_conversations_status_chk CHECK (status IN ('open', 'pending', 'solved')),
  CONSTRAINT whatsapp_conversations_unread_chk CHECK (unread_count >= 0)
);

CREATE INDEX IF NOT EXISTS whatsapp_conversations_workspace_activity_idx
  ON public.whatsapp_conversations (workspace_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS whatsapp_conversations_assignee_idx
  ON public.whatsapp_conversations (workspace_id, assignee_id)
  WHERE assignee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS whatsapp_conversations_team_idx
  ON public.whatsapp_conversations (workspace_id, assigned_team_id)
  WHERE assigned_team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS whatsapp_conversations_tags_idx
  ON public.whatsapp_conversations USING GIN (tags);

-- ============================================================
-- 5. Backfill conversations from existing message history
-- ============================================================

INSERT INTO public.whatsapp_conversations (
  workspace_id, contact_phone, contact_name,
  last_message_at, last_direction, last_message_preview, unread_count
)
SELECT
  m.workspace_id,
  m.contact_phone,
  (ARRAY_AGG(m.contact_name ORDER BY m.sent_at DESC) FILTER (WHERE m.contact_name IS NOT NULL))[1],
  MAX(m.sent_at),
  (ARRAY_AGG(m.direction ORDER BY m.sent_at DESC))[1]::TEXT,
  (ARRAY_AGG(m.body      ORDER BY m.sent_at DESC))[1],
  0
FROM public.whatsapp_messages m
WHERE m.contact_phone IS NOT NULL AND m.contact_phone <> ''
GROUP BY m.workspace_id, m.contact_phone
ON CONFLICT (workspace_id, contact_phone) DO NOTHING;

-- Unread = inbound messages newer than the last outbound reply.
UPDATE public.whatsapp_conversations c
SET unread_count = sub.unread
FROM (
  SELECT
    m.workspace_id,
    m.contact_phone,
    COUNT(*) FILTER (
      WHERE m.direction = 'inbound'
        AND m.sent_at > COALESCE((
          SELECT MAX(o.sent_at) FROM public.whatsapp_messages o
          WHERE o.workspace_id = m.workspace_id
            AND o.contact_phone = m.contact_phone
            AND o.direction = 'outbound'
        ), '-infinity'::TIMESTAMPTZ)
    ) AS unread
  FROM public.whatsapp_messages m
  GROUP BY m.workspace_id, m.contact_phone
) sub
WHERE c.workspace_id = sub.workspace_id
  AND c.contact_phone = sub.contact_phone
  AND sub.unread > 0;

-- ============================================================
-- 6. Grants + RLS
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_conversations TO authenticated;
GRANT ALL    ON public.whatsapp_conversations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_teams         TO authenticated;
GRANT ALL    ON public.whatsapp_teams         TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_team_members  TO authenticated;
GRANT ALL    ON public.whatsapp_team_members  TO service_role;

ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wa_conv_select_workspace_members" ON public.whatsapp_conversations;
CREATE POLICY "wa_conv_select_workspace_members" ON public.whatsapp_conversations
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "wa_conv_insert_workspace_members" ON public.whatsapp_conversations;
CREATE POLICY "wa_conv_insert_workspace_members" ON public.whatsapp_conversations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "wa_conv_update_workspace_members" ON public.whatsapp_conversations;
CREATE POLICY "wa_conv_update_workspace_members" ON public.whatsapp_conversations
  FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "wa_conv_delete_workspace_members" ON public.whatsapp_conversations;
CREATE POLICY "wa_conv_delete_workspace_members" ON public.whatsapp_conversations
  FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

ALTER TABLE public.whatsapp_teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wa_teams_select_workspace_members" ON public.whatsapp_teams;
CREATE POLICY "wa_teams_select_workspace_members" ON public.whatsapp_teams
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "wa_teams_write_workspace_members" ON public.whatsapp_teams;
CREATE POLICY "wa_teams_write_workspace_members" ON public.whatsapp_teams
  FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

ALTER TABLE public.whatsapp_team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wa_team_members_select" ON public.whatsapp_team_members;
CREATE POLICY "wa_team_members_select" ON public.whatsapp_team_members
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.whatsapp_teams t
      WHERE t.id = team_id AND public.is_workspace_member(t.workspace_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "wa_team_members_write" ON public.whatsapp_team_members;
CREATE POLICY "wa_team_members_write" ON public.whatsapp_team_members
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.whatsapp_teams t
      WHERE t.id = team_id AND public.is_workspace_member(t.workspace_id, auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.whatsapp_teams t
      WHERE t.id = team_id AND public.is_workspace_member(t.workspace_id, auth.uid())
    )
  );

-- ============================================================
-- 7. Realtime
-- ============================================================
-- Default replica identity (primary key) is enough here: the inbox only consumes the new row on
-- INSERT/UPDATE and never needs old_record, so REPLICA IDENTITY FULL would add WAL for nothing.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversations;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
