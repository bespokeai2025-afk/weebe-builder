-- WATI + generic leads CRM: campaign launch from Webee, message ↔ lead linking

alter table whatsapp_campaigns
  add column if not exists provider text default 'twilio',
  add column if not exists wati_template_name text,
  add column if not exists template_params jsonb,
  add column if not exists wati_broadcast_name text,
  add column if not exists started_at timestamptz;

alter table whatsapp_messages
  add column if not exists campaign_id uuid references whatsapp_campaigns(id) on delete set null,
  add column if not exists provider text;

alter table leads
  add column if not exists whatsapp_opt_in boolean default true;

create index if not exists whatsapp_messages_lead_id_idx
  on whatsapp_messages (workspace_id, lead_id, sent_at desc);

create index if not exists whatsapp_messages_campaign_id_idx
  on whatsapp_messages (campaign_id)
  where campaign_id is not null;

create index if not exists leads_workspace_phone_idx
  on leads (workspace_id, phone);
