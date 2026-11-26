-- WATI template lifecycle fields (status mirror + webhook updates; creation stays in WATI UI)

alter table wati_templates
  add column if not exists body_preview text,
  add column if not exists rejection_reason text,
  add column if not exists quality text,
  add column if not exists status_code int,
  add column if not exists last_status_at timestamptz,
  add column if not exists wati_modified_at timestamptz;

create index if not exists wati_templates_workspace_status_idx
  on wati_templates (workspace_id, status);
