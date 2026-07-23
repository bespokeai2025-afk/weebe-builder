-- Per-tenant WATI API host (e.g. eu-api.wati.io vs live-mt-server.wati.io)
alter table wati_connections
  add column if not exists api_host text;
