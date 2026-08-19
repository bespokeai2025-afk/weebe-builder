-- Add do_not_contact flag to wbah_crm_contacts.
-- Set to true when a post-call negative sentiment is detected so the contact
-- is excluded from future WBAH campaign queues at the WEBEE level, independently
-- of whether the Dynamics donotphone PATCH succeeded.

alter table if exists wbah_crm_contacts
  add column if not exists do_not_contact boolean not null default false;

-- Partial index — only index rows that are actually blocked to keep it cheap.
create index if not exists idx_wbah_crm_contacts_dnc
  on wbah_crm_contacts (workspace_id, do_not_contact)
  where do_not_contact = true;

comment on column wbah_crm_contacts.do_not_contact is
  'True when the contact''s most-recent call had negative sentiment. '
  'Excludes the contact from future WEBEE campaign queues regardless of '
  'Dynamics sync state. Set by the post-call pipeline; never cleared automatically.';
