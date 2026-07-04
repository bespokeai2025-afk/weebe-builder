-- ── SystemMind n8n Discovery & Understanding (spec Phases 1–2) ─────────────────
-- Apply MANUALLY in the Supabase SQL Editor (Dashboard → SQL Editor → Run).
-- Strictly ADDITIVE. Idempotent: all statements use IF NOT EXISTS / guards.
--
-- Stores one row per discovered n8n workflow (upserted by workspace_id +
-- n8n_workflow_id) with extracted metadata, the raw workflow snapshot, and the
-- AI-generated "understanding" blob. Read-only discovery — nothing here mutates
-- n8n itself.

create table if not exists public.systemmind_n8n_workflows (
  id                uuid        primary key default gen_random_uuid(),
  workspace_id      uuid        not null references public.workspaces(id) on delete cascade,

  -- ── Identity / list columns ────────────────────────────────────────────────
  n8n_workflow_id   text        not null,
  name              text        not null default 'Untitled',
  active            boolean     not null default false,
  folder            text,
  tags              text[]      not null default '{}',
  trigger_types     text[]      not null default '{}',
  node_count        integer     not null default 0,
  connection_count  integer     not null default 0,
  node_types        text[]      not null default '{}',
  integrations      text[]      not null default '{}',
  has_webhook       boolean     not null default false,

  -- ── Structured metadata + raw snapshot ─────────────────────────────────────
  metadata          jsonb       not null default '{}'::jsonb,  -- full extracted metadata
  raw_snapshot      jsonb       not null default '{}'::jsonb,  -- raw workflow definition (read-only)

  -- ── AI understanding (persisted; survives re-scan when snapshot unchanged) ──
  understanding     jsonb,                                     -- business/technical summary, flow, etc.
  confidence        integer,                                   -- 0-100
  ai_model          text,
  understood_at     timestamptz,

  -- ── Timestamps ─────────────────────────────────────────────────────────────
  n8n_created_at    timestamptz,
  n8n_updated_at    timestamptz,
  discovered_at     timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (workspace_id, n8n_workflow_id)
);

create index if not exists sm_n8n_ws_idx
  on public.systemmind_n8n_workflows (workspace_id, discovered_at desc);
create index if not exists sm_n8n_name_idx
  on public.systemmind_n8n_workflows (workspace_id, name);

-- ── RLS ────────────────────────────────────────────────────────────────────────
alter table public.systemmind_n8n_workflows enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'systemmind_n8n_workflows' and policyname = 'sm_n8n_sel') then
    create policy "sm_n8n_sel" on public.systemmind_n8n_workflows for select
      using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'systemmind_n8n_workflows' and policyname = 'sm_n8n_ins') then
    create policy "sm_n8n_ins" on public.systemmind_n8n_workflows for insert
      with check (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'systemmind_n8n_workflows' and policyname = 'sm_n8n_upd') then
    create policy "sm_n8n_upd" on public.systemmind_n8n_workflows for update
      using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'systemmind_n8n_workflows' and policyname = 'sm_n8n_del') then
    create policy "sm_n8n_del" on public.systemmind_n8n_workflows for delete
      using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
  end if;
end $$;

-- ── Grants ──────────────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.systemmind_n8n_workflows to authenticated;
grant all on public.systemmind_n8n_workflows to service_role;
