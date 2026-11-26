-- AccountsMind invoice settings: the base singleton table.
--
-- Production's table was created outside the migrations (SQL editor), and
-- 20260723100000_accountsmind_invoice_phase1.sql only extends it, so a fresh database could not be
-- built. This creates the original shape (one row, id = 1) when it is missing; on a database that
-- already has the table it does nothing. Server-write-only like the other accountsmind_invoice*
-- tables: RLS on, no policies.

create table if not exists public.accountsmind_invoice_settings (
  id           integer primary key default 1 check (id = 1),
  from_name    text not null default '',
  from_address text not null default '',
  updated_at   timestamptz not null default now()
);

alter table public.accountsmind_invoice_settings enable row level security;
revoke all on public.accountsmind_invoice_settings from anon, authenticated;
