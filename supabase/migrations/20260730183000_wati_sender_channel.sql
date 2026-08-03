-- Track which WATI WhatsApp number sent each outbound message (multi-number warm-up)
alter table whatsapp_messages
  add column if not exists sender_channel text;

create index if not exists whatsapp_messages_sender_channel_idx
  on whatsapp_messages (workspace_id, sender_channel, sent_at desc)
  where sender_channel is not null and direction = 'outbound';
