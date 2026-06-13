-- Adds multi-step workflow state to WhatsApp sessions.
-- workflow_variables: extracted named variables accumulated over the conversation.
-- waiting_for_reply: true when the flow is paused at a wa_wait_reply node.

ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS workflow_variables JSONB    NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS waiting_for_reply  BOOLEAN  NOT NULL DEFAULT false;
