-- Track manual vs API webhook setup for WATI (auto-register often 404 on EU tenants).
alter table wati_connections
  add column if not exists inbound_webhook_url text,
  add column if not exists webhook_manual boolean not null default false;
