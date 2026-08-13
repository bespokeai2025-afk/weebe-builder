-- WATI chat-status parity: the "Expired" / "Open" / "Solved" and "Campaign" / "Bot" chips that
-- WATI shows on every chat in its own inbox.
--
-- `status` stays operator-owned (our own triage state). WATI's view of the chat lands in separate
-- wati_* columns so the two never fight each other.

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS wati_chat_status    TEXT,
  ADD COLUMN IF NOT EXISTS wati_chat_status_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wati_topic          TEXT,
  ADD COLUMN IF NOT EXISTS wati_agent_name     TEXT,
  -- Drives the 24h session-window ("Expired") chip without another WATI round-trip.
  ADD COLUMN IF NOT EXISTS last_inbound_at     TIMESTAMPTZ,
  -- Where the newest outbound message came from: campaign / bot / template / wati.
  ADD COLUMN IF NOT EXISTS last_message_origin TEXT;

-- whatsapp_messages.sender_channel is overloaded: campaign sends store the *sending WhatsApp
-- number* there (multi-number warmup allocation), while WATI-side messages store an origin name.
-- So origin is derived from campaign_id first and only falls back to the known channel names.
ALTER TABLE public.whatsapp_conversations
  DROP COLUMN IF EXISTS last_sender_channel;

DO $$
BEGIN
  ALTER TABLE public.whatsapp_conversations
    ADD CONSTRAINT whatsapp_conversations_wati_status_chk
    CHECK (wati_chat_status IS NULL
           OR wati_chat_status IN ('open', 'pending', 'solved', 'expired'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS whatsapp_conversations_wati_status_idx
  ON public.whatsapp_conversations (workspace_id, wati_chat_status)
  WHERE wati_chat_status IS NOT NULL;

-- ============================================================
-- Backfill the derived columns from existing message history
-- ============================================================

UPDATE public.whatsapp_conversations c
SET last_inbound_at     = sub.last_inbound_at,
    last_message_origin = sub.last_message_origin
FROM (
  SELECT
    m.workspace_id,
    m.contact_phone,
    MAX(m.sent_at) FILTER (WHERE m.direction = 'inbound') AS last_inbound_at,
    (ARRAY_AGG(
       CASE
         WHEN m.campaign_id IS NOT NULL THEN 'campaign'
         WHEN m.sender_channel IN ('bot', 'campaign', 'template', 'wati') THEN m.sender_channel
       END
       ORDER BY m.sent_at DESC
     ) FILTER (WHERE m.direction = 'outbound'))[1] AS last_message_origin
  FROM public.whatsapp_messages m
  WHERE m.contact_phone IS NOT NULL AND m.contact_phone <> ''
  GROUP BY m.workspace_id, m.contact_phone
) sub
WHERE c.workspace_id = sub.workspace_id
  AND c.contact_phone = sub.contact_phone;

-- ============================================================
-- Recompute fn: also derive last_inbound_at + last_sender_channel
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_whatsapp_conversation(
  _workspace_id  UUID,
  _contact_phone TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _workspace_id IS NULL OR COALESCE(_contact_phone, '') = '' THEN
    RETURN;
  END IF;

  WITH msgs AS (
    SELECT sent_at, direction, body, contact_name, conversation_id, ticket_id, sender_channel,
           campaign_id
    FROM public.whatsapp_messages
    WHERE workspace_id = _workspace_id
      AND contact_phone = _contact_phone
  ),
  last_out AS (
    SELECT MAX(sent_at) AS at FROM msgs WHERE direction = 'outbound'
  ),
  agg AS (
    SELECT
      (SELECT MAX(sent_at) FROM msgs) AS last_message_at,
      (SELECT direction::TEXT FROM msgs ORDER BY sent_at DESC LIMIT 1) AS last_direction,
      (SELECT LEFT(COALESCE(body, ''), 200) FROM msgs ORDER BY sent_at DESC LIMIT 1) AS last_preview,
      (SELECT contact_name FROM msgs WHERE contact_name IS NOT NULL
         ORDER BY sent_at DESC LIMIT 1) AS contact_name,
      (SELECT conversation_id FROM msgs WHERE conversation_id IS NOT NULL
         ORDER BY sent_at DESC LIMIT 1) AS wati_conversation_id,
      (SELECT ticket_id FROM msgs WHERE ticket_id IS NOT NULL
         ORDER BY sent_at DESC LIMIT 1) AS wati_ticket_id,
      (SELECT MAX(sent_at) FROM msgs WHERE direction = 'inbound') AS last_inbound_at,
      (SELECT CASE
                WHEN campaign_id IS NOT NULL THEN 'campaign'
                WHEN sender_channel IN ('bot', 'campaign', 'template', 'wati') THEN sender_channel
              END
         FROM msgs WHERE direction = 'outbound'
         ORDER BY sent_at DESC LIMIT 1) AS last_message_origin,
      (SELECT COUNT(*) FROM msgs, last_out
         WHERE msgs.direction = 'inbound'
           AND msgs.sent_at > COALESCE(last_out.at, '-infinity'::TIMESTAMPTZ)) AS unread
    FROM msgs
    LIMIT 1
  )
  INSERT INTO public.whatsapp_conversations AS c (
    workspace_id, contact_phone, contact_name,
    wati_conversation_id, wati_ticket_id,
    last_message_at, last_direction, last_message_preview,
    last_inbound_at, last_message_origin,
    unread_count, status
  )
  SELECT
    _workspace_id, _contact_phone, agg.contact_name,
    agg.wati_conversation_id, agg.wati_ticket_id,
    agg.last_message_at, agg.last_direction, agg.last_preview,
    agg.last_inbound_at, agg.last_message_origin,
    agg.unread,
    'open'
  FROM agg
  ON CONFLICT (workspace_id, contact_phone) DO UPDATE SET
    contact_name         = COALESCE(EXCLUDED.contact_name, c.contact_name),
    wati_conversation_id = COALESCE(EXCLUDED.wati_conversation_id, c.wati_conversation_id),
    wati_ticket_id       = COALESCE(EXCLUDED.wati_ticket_id, c.wati_ticket_id),
    last_message_at      = EXCLUDED.last_message_at,
    last_direction       = EXCLUDED.last_direction,
    last_message_preview = EXCLUDED.last_message_preview,
    last_inbound_at      = EXCLUDED.last_inbound_at,
    last_message_origin  = EXCLUDED.last_message_origin,
    unread_count         = EXCLUDED.unread_count,
    -- A new inbound message reopens a solved chat, matching WATI's own behaviour.
    status               = CASE
                             WHEN c.status = 'solved' AND EXCLUDED.unread_count > 0 THEN 'open'
                             ELSE c.status
                           END,
    updated_at           = NOW();
END;
$$;

REVOKE ALL ON FUNCTION public.sync_whatsapp_conversation(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_whatsapp_conversation(UUID, TEXT) TO service_role;
