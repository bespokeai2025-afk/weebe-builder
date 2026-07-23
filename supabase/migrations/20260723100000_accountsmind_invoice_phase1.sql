-- AccountsMind Invoices Phase 1: business profile, payment profiles, service
-- catalogue, client-specific pricing, payments, audit log, invoice lifecycle
-- columns. Additive + idempotent. All new tables are server-write-only
-- (RLS on, zero policies, REVOKE anon/authenticated) — same pattern as the
-- existing accountsmind_invoice* tables.

-- ── 1. Business profile: extend the singleton settings row ──────────────────
alter table public.accountsmind_invoice_settings
  add column if not exists from_legal_name        text not null default '',
  add column if not exists from_email             text not null default '',
  add column if not exists from_phone             text not null default '',
  add column if not exists from_website           text not null default '',
  add column if not exists from_company_number    text not null default '',
  add column if not exists from_vat_number        text not null default '',
  add column if not exists from_tax_number        text not null default '',
  add column if not exists from_logo_path         text not null default '',
  add column if not exists default_currency       text not null default 'GBP',
  add column if not exists default_tax_rate_percent numeric(5,2) not null default 20,
  add column if not exists default_payment_terms  text not null default 'Payment due within 30 days',
  add column if not exists default_due_days       integer not null default 30,
  add column if not exists invoice_footer         text not null default '',
  add column if not exists signatory_name         text not null default '',
  add column if not exists number_prefix          text not null default 'INV',
  add column if not exists number_include_year    boolean not null default true,
  add column if not exists number_pad_width       integer not null default 4;

-- ── 2. Payment profiles (banking details, per currency) ─────────────────────
create table if not exists public.accountsmind_payment_profiles (
  id                   uuid primary key default gen_random_uuid(),
  label                text not null,
  currency             text not null default 'GBP',
  bank_name            text not null default '',
  account_name         text not null default '',
  account_number       text not null default '',
  sort_code            text not null default '',
  iban                 text not null default '',
  swift_bic            text not null default '',
  routing_number       text not null default '',
  bank_address         text not null default '',
  payment_link         text not null default '',
  payment_instructions text not null default '',
  is_default           boolean not null default false,
  archived             boolean not null default false,
  created_by_user_id   uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter table public.accountsmind_payment_profiles enable row level security;
revoke all on public.accountsmind_payment_profiles from anon, authenticated;

-- ── 3. Service catalogue ─────────────────────────────────────────────────────
create table if not exists public.accountsmind_services (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  public_description   text not null default '',
  internal_description text not null default '',
  category             text not null default '',
  sku                  text not null default '',
  unit                 text not null default 'each',
  unit_price_cents     bigint not null default 0,
  cost_price_cents     bigint,
  currency             text not null default 'GBP',
  tax_rate_percent     numeric(5,2) not null default 20,
  tax_inclusive        boolean not null default false,
  recurring            boolean not null default false,
  billing_frequency    text not null default '',
  archived             boolean not null default false,
  created_by_user_id   uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter table public.accountsmind_services enable row level security;
revoke all on public.accountsmind_services from anon, authenticated;
create index if not exists accountsmind_services_active_idx
  on public.accountsmind_services (archived, name);

-- ── 4. Client-specific service pricing ───────────────────────────────────────
create table if not exists public.accountsmind_client_service_prices (
  id                uuid primary key default gen_random_uuid(),
  service_id        uuid not null references public.accountsmind_services(id) on delete cascade,
  workspace_id      uuid not null,
  unit_price_cents  bigint not null,
  currency          text,
  note              text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (service_id, workspace_id)
);
alter table public.accountsmind_client_service_prices enable row level security;
revoke all on public.accountsmind_client_service_prices from anon, authenticated;
create index if not exists accountsmind_csp_ws_idx
  on public.accountsmind_client_service_prices (workspace_id);

-- ── 5. Invoice payments (full/partial, multiple) ─────────────────────────────
create table if not exists public.accountsmind_invoice_payments (
  id                 uuid primary key default gen_random_uuid(),
  invoice_id         uuid not null references public.accountsmind_invoices(id) on delete cascade,
  paid_on            date not null default current_date,
  amount_cents       bigint not null,
  currency           text not null default 'GBP',
  method             text not null default '',
  reference          text not null default '',
  notes              text not null default '',
  created_by_user_id uuid,
  created_at         timestamptz not null default now()
);
alter table public.accountsmind_invoice_payments enable row level security;
revoke all on public.accountsmind_invoice_payments from anon, authenticated;
create index if not exists accountsmind_invoice_payments_inv_idx
  on public.accountsmind_invoice_payments (invoice_id, created_at desc);

-- ── 6. Invoice audit log ─────────────────────────────────────────────────────
create table if not exists public.accountsmind_invoice_audit_log (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid,
  action        text not null,
  detail_json   jsonb not null default '{}'::jsonb,
  actor_user_id uuid,
  created_at    timestamptz not null default now()
);
alter table public.accountsmind_invoice_audit_log enable row level security;
revoke all on public.accountsmind_invoice_audit_log from anon, authenticated;
create index if not exists accountsmind_invoice_audit_inv_idx
  on public.accountsmind_invoice_audit_log (invoice_id, created_at desc);

-- ── 7. Invoice lifecycle columns (additive) ──────────────────────────────────
alter table public.accountsmind_invoices
  add column if not exists issue_date         date,
  add column if not exists amount_paid_cents  bigint not null default 0,
  add column if not exists discount_cents     bigint not null default 0,
  add column if not exists po_number          text not null default '',
  add column if not exists client_reference   text not null default '',
  add column if not exists payment_terms      text not null default '',
  add column if not exists customer_notes     text not null default '',
  add column if not exists internal_notes     text not null default '',
  add column if not exists payment_profile_id uuid references public.accountsmind_payment_profiles(id) on delete set null,
  add column if not exists is_imported        boolean not null default false,
  add column if not exists sent_at            timestamptz,
  add column if not exists voided_at          timestamptz;

create index if not exists accountsmind_invoices_due_idx
  on public.accountsmind_invoices (due_date)
  where due_date is not null;
