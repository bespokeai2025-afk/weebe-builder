-- Track WATI/WhatsApp WAMID separately from our localMessageId (lead_*).
-- READ/DELIVERED webhooks often omit waId and only include localMessageId + whatsappMessageId.
alter table public.whatsapp_messages
  add column if not exists whatsapp_message_id text;

create index if not exists whatsapp_messages_wamid_idx
  on public.whatsapp_messages (workspace_id, whatsapp_message_id)
  where whatsapp_message_id is not null;
