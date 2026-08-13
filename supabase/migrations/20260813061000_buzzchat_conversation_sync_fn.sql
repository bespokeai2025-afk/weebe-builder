-- Recompute one conversation's denormalised state from its message history.
--
-- Derived rather than incremented on purpose: WATI retries webhooks, and the message upsert is
-- idempotent, so an "unread_count + 1" style update would double-count on every redelivery.
-- Recomputing from whatsapp_messages makes repeat calls harmless.
--
-- Operator-owned fields (assignee_id, assigned_team_id, tags, attributes) are never touched here.

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
    SELECT sent_at, direction, body, contact_name, conversation_id, ticket_id
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
    unread_count, status
  )
  SELECT
    _workspace_id, _contact_phone, agg.contact_name,
    agg.wati_conversation_id, agg.wati_ticket_id,
    agg.last_message_at, agg.last_direction, agg.last_preview,
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

-- Marking a thread read is a plain UPDATE from the user's own client — the existing
-- wa_conv_update_workspace_members RLS policy already scopes it, so no RPC is needed.
