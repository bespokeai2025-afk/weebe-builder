-- WATI Optional Connector tables
-- WATI is never required. All tables are additive.

create table if not exists wati_connections (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     text not null unique,
  api_key          text not null,
  tenant_id        text not null,
  webhook_secret   text,
  status           text not null default 'connected' check (status in ('connected','disconnected','error')),
  last_tested_at   timestamptz,
  error_message    text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create table if not exists wati_templates (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     text not null,
  wati_template_id text not null,
  name             text not null,
  status           text,
  language         text,
  category         text,
  components       jsonb,
  synced_at        timestamptz default now(),
  unique (workspace_id, wati_template_id)
);

create table if not exists wati_campaigns (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     text not null,
  wati_campaign_id text not null,
  name             text not null,
  status           text,
  template_name    text,
  broadcast_name   text,
  sent             int default 0,
  delivered        int default 0,
  read_count       int default 0,
  failed           int default 0,
  synced_at        timestamptz default now(),
  unique (workspace_id, wati_campaign_id)
);

create table if not exists wati_contacts (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     text not null,
  wati_contact_id  text not null,
  phone            text not null,
  name             text,
  tags             text[],
  opted_in         boolean default false,
  synced_at        timestamptz default now(),
  unique (workspace_id, wati_contact_id)
);

create table if not exists wati_sync_logs (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     text not null,
  sync_type        text not null check (sync_type in ('templates','campaigns','contacts','test')),
  status           text not null check (status in ('success','error')),
  records_synced   int default 0,
  error_message    text,
  created_at       timestamptz default now()
);

alter table wati_connections  enable row level security;
alter table wati_templates    enable row level security;
alter table wati_campaigns    enable row level security;
alter table wati_contacts     enable row level security;
alter table wati_sync_logs    enable row level security;
