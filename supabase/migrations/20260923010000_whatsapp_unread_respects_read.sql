-- Make the WhatsApp unread badge mean "unread", not "unreplied".
--
-- sync_whatsapp_conversation() recomputes unread_count as the number of inbound messages since the
-- last outbound one, ignoring last_read_at entirely. The trigger on whatsapp_messages runs it on
-- every insert or update for that phone, so it repeatedly overwrote the zero written by
-- markWhatsappThreadRead. The visible effect: a thread the team had opened and read, but chosen not
-- to reply to, kept its highlight indefinitely.
--
-- Only the conflict branch changes. A brand-new conversation has no last_read_at, so the insert
-- path is unchanged, and the counting logic itself is untouched.

CREATE OR REPLACE FUNCTION public.sync_whatsapp_conversation(_workspace_id uuid, _contact_phone text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Reading a thread clears the badge, replying is not required.
    --
    -- EXCLUDED.unread_count counts inbound messages since the last OUTBOUND one, which is
    -- "unreplied", not "unread". Because this function re-runs on every message insert, it kept
    -- overwriting the zero that marking-as-read had written, so a thread that had been read and
    -- deliberately not replied to stayed badged forever.
    unread_count         = CASE
                             WHEN c.last_read_at IS NOT NULL
                              AND c.last_read_at >= EXCLUDED.last_message_at THEN 0
                             ELSE EXCLUDED.unread_count
                           END,
    -- A new inbound message reopens a solved chat, matching WATI's own behaviour. Uses the same
    -- read-aware count, or reading a solved thread would reopen it on the next message touch.
    status               = CASE
                             WHEN c.status = 'solved'
                              AND EXCLUDED.unread_count > 0
                              AND (c.last_read_at IS NULL
                                   OR c.last_read_at < EXCLUDED.last_message_at) THEN 'open'
                             ELSE c.status
                           END,
    updated_at           = NOW();
END;
$function$
;
