-- Buzzchat: opt-out / do-not-contact flag on WhatsApp contacts
alter table whatsapp_contacts
  add column if not exists do_not_contact boolean not null default false;

create index if not exists whatsapp_contacts_dnc_idx
  on whatsapp_contacts (workspace_id, do_not_contact)
  where do_not_contact = true;
