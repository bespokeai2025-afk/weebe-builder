-- AccountsMind invoice generator: uploaded DOCX templates + generated invoices.
-- Server-write-only tables (service_role); platform-admin surface only.

create table if not exists accountsmind_invoice_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  file_name text not null,
  storage_path text not null,
  placeholders_json jsonb not null default '[]'::jsonb,
  uploaded_by_user_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists accountsmind_invoices (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references accountsmind_invoice_templates(id) on delete set null,
  workspace_id uuid not null,
  invoice_number text not null,
  invoice_month text not null,           -- YYYY-MM billing period
  client_name text not null,
  currency text not null default 'GBP',
  subtotal_cents bigint not null default 0,
  tax_rate_percent numeric not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  line_items_json jsonb not null default '[]'::jsonb,
  data_json jsonb not null default '{}'::jsonb,   -- full placeholder payload used
  storage_path text not null,
  generated_by_user_id uuid,
  created_at timestamptz not null default now()
);

create unique index if not exists accountsmind_invoices_number_uq
  on accountsmind_invoices (invoice_number);
create index if not exists accountsmind_invoices_ws_idx
  on accountsmind_invoices (workspace_id, created_at desc);

alter table accountsmind_invoice_templates enable row level security;
alter table accountsmind_invoices enable row level security;

-- Server-write-only: no policies for authenticated; revoke default grants.
revoke all on accountsmind_invoice_templates from anon, authenticated;
revoke all on accountsmind_invoices from anon, authenticated;
