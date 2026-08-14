-- Guarantee every message produces a conversation row.
--
-- The BuzzChat inbox lists threads from whatsapp_conversations, so a message inserted without a
-- matching conversation row is invisible in the UI even though the data is there. That is what
-- happened to campaign sends: sendWatiCampaign inserted into whatsapp_messages and never created
-- the conversation, so 150+ sends to new contacts never appeared in the inbox.
--
-- Several other paths insert messages too (workflow steps, the Twilio/Meta webhook, runtime sends).
-- Rather than remembering to call sync_whatsapp_conversation from each one, the database keeps the
-- two tables consistent. sync_whatsapp_conversation recomputes from message history and is
-- idempotent, so firing it per row is safe and repeat calls are harmless.

CREATE OR REPLACE FUNCTION public.whatsapp_messages_sync_conversation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.contact_phone, '') <> '' AND NEW.workspace_id IS NOT NULL THEN
    -- Touches whatsapp_conversations only, so this cannot recurse into itself.
    PERFORM public.sync_whatsapp_conversation(NEW.workspace_id, NEW.contact_phone);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_messages_sync_conversation_trg ON public.whatsapp_messages;

CREATE TRIGGER whatsapp_messages_sync_conversation_trg
AFTER INSERT OR UPDATE OF
  sent_at, direction, body, contact_name, conversation_id, ticket_id, sender_channel, campaign_id
ON public.whatsapp_messages
FOR EACH ROW
EXECUTE FUNCTION public.whatsapp_messages_sync_conversation();

-- ============================================================
-- Backfill threads whose messages never got a conversation row
-- ============================================================

DO $$
DECLARE
  row_rec RECORD;
BEGIN
  FOR row_rec IN
    SELECT DISTINCT workspace_id, contact_phone
    FROM public.whatsapp_messages
    WHERE COALESCE(contact_phone, '') <> '' AND workspace_id IS NOT NULL
  LOOP
    PERFORM public.sync_whatsapp_conversation(row_rec.workspace_id, row_rec.contact_phone);
  END LOOP;
END $$;
