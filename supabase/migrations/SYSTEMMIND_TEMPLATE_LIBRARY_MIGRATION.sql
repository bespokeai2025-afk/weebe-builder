-- ── SystemMind Template Library & Parameters (spec Phases 3, 4, 7) ────────────
-- Apply MANUALLY in the Supabase SQL Editor (Dashboard → SQL Editor → Run).
-- Strictly ADDITIVE. Idempotent: every statement uses IF NOT EXISTS / guards.
--
-- Builds on the #295 discovery table (systemmind_n8n_workflows):
--   (A) adds nullable classification columns to that table (safe: re-scan upserts
--       only the discovery columns, so classification persists across scans),
--   (B) adds a curated template repository (systemmind_workflow_templates),
--   (C) adds template version history (systemmind_template_versions).
-- Nothing here mutates n8n. Templates are curated artifacts only — never deployed.

-- ── (A) Classification columns on the discovery table ─────────────────────────
alter table public.systemmind_n8n_workflows
  add column if not exists template_type    text;        -- reusable_template | customer_specific | experimental | legacy | archive
alter table public.systemmind_n8n_workflows
  add column if not exists workflow_category text;        -- Receptionist | Lead Generation | ...
alter table public.systemmind_n8n_workflows
  add column if not exists classification    jsonb;       -- { type, category, reasoning, signals[], confidence, auto, snapshot_updated_at }
alter table public.systemmind_n8n_workflows
  add column if not exists classified_at     timestamptz;
alter table public.systemmind_n8n_workflows
  add column if not exists classified_by     uuid;        -- null when auto-classified by AI

-- ── (B) Curated template repository ───────────────────────────────────────────
create table if not exists public.systemmind_workflow_templates (
  id                            uuid        primary key default gen_random_uuid(),
  workspace_id                  uuid        not null references public.workspaces(id) on delete cascade,

  -- ── Identity / classification ──────────────────────────────────────────────
  name                          text        not null,
  description                   text,
  business_purpose              text,
  category                      text,
  template_type                 text        not null default 'reusable_template',

  -- ── Lifecycle / trust ──────────────────────────────────────────────────────
  status                        text        not null default 'draft',   -- draft | pending_approval | approved | archived
  is_trusted                    boolean     not null default false,      -- only ever set true on approval
  confidence                    integer,                                 -- 0-100
  readiness                     text,                                    -- not_ready | needs_review | ready
  risk_rating                   text,                                    -- low | medium | high
  known_limitations             text[]      not null default '{}',

  -- ── Supported providers ────────────────────────────────────────────────────
  supported_agent_providers     text[]      not null default '{}',
  supported_crm_providers       text[]      not null default '{}',
  supported_calendar_providers  text[]      not null default '{}',
  supported_telephony_providers text[]      not null default '{}',
  supported_messaging_providers text[]      not null default '{}',

  -- ── Requirements / parameters ──────────────────────────────────────────────
  required_apis                 text[]      not null default '{}',
  required_credentials          text[]      not null default '{}',
  deployment_variables          jsonb       not null default '[]'::jsonb, -- [{ key,name,type,category,description,example,required,source }]

  -- ── Summaries / dependencies ───────────────────────────────────────────────
  business_summary              text,
  technical_summary             text,
  dependencies                  text[]      not null default '{}',

  -- ── Linked sources ─────────────────────────────────────────────────────────
  linked_n8n_workflow_ids       uuid[]      not null default '{}',       -- systemmind_n8n_workflows.id
  linked_builder_template_ids   text[]      not null default '{}',
  linked_retell_agent_ids       text[]      not null default '{}',

  -- ── Structure snapshot (redacted; safe for export) ─────────────────────────
  structure                     jsonb       not null default '{}'::jsonb, -- { nodes:[{id,name,type}], edges:[{from,to}], order:[] }
  tags                          text[]      not null default '{}',
  source_kind                   text        not null default 'n8n',       -- n8n | manual | import

  -- ── Versioning / audit ─────────────────────────────────────────────────────
  current_version               integer     not null default 1,
  created_by                    uuid,
  approved_by                   uuid,
  approved_at                   timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create index if not exists sm_tpl_ws_idx     on public.systemmind_workflow_templates (workspace_id, updated_at desc);
create index if not exists sm_tpl_cat_idx    on public.systemmind_workflow_templates (workspace_id, category);
create index if not exists sm_tpl_status_idx on public.systemmind_workflow_templates (workspace_id, status);

-- ── (C) Template version history (full snapshots) ─────────────────────────────
create table if not exists public.systemmind_template_versions (
  id            uuid        primary key default gen_random_uuid(),
  workspace_id  uuid        not null references public.workspaces(id) on delete cascade,
  template_id   uuid        not null references public.systemmind_workflow_templates(id) on delete cascade,
  version       integer     not null,
  snapshot      jsonb       not null default '{}'::jsonb,   -- full template payload at this version
  status        text,
  change_note   text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  unique (template_id, version)
);
create index if not exists sm_tplver_ws_idx  on public.systemmind_template_versions (workspace_id);
create index if not exists sm_tplver_tpl_idx on public.systemmind_template_versions (template_id, version desc);

-- ── RLS ────────────────────────────────────────────────────────────────────────
alter table public.systemmind_workflow_templates enable row level security;
alter table public.systemmind_template_versions  enable row level security;

-- Policies are intentionally SELECT-only for authenticated members. All writes
-- flow through the service-role client inside the admin-gated server functions,
-- so members can never forge the approval lifecycle (status/is_trusted) via
-- direct PostgREST calls. is_trusted is the trust anchor for downstream
-- deployment phases and must stay unforgeable at the database layer.
do $$
begin
  -- systemmind_workflow_templates — member read-only
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'systemmind_workflow_templates' and policyname = 'sm_tpl_sel') then
    create policy "sm_tpl_sel" on public.systemmind_workflow_templates for select
      using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
  end if;

  -- systemmind_template_versions — member read-only
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'systemmind_template_versions' and policyname = 'sm_tplver_sel') then
    create policy "sm_tplver_sel" on public.systemmind_template_versions for select
      using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
  end if;
end $$;

-- ── Grants ──────────────────────────────────────────────────────────────────────
-- Read-only for authenticated members; writes are service-role only.
grant select on public.systemmind_workflow_templates to authenticated;
grant select on public.systemmind_template_versions  to authenticated;
grant all on public.systemmind_workflow_templates to service_role;
grant all on public.systemmind_template_versions  to service_role;
