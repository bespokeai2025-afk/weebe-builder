-- Structured CSV fields on Buzzchat contacts (JVC property registry, etc.)
alter table whatsapp_contacts
  add column if not exists import_meta jsonb not null default '{}'::jsonb;

create index if not exists whatsapp_contacts_import_meta_gin
  on whatsapp_contacts using gin (import_meta);
