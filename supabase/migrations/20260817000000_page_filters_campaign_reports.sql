-- Workspace Page Filters + Campaign Reports
-- Additive only. Workspace-scoped; RLS = workspace_members pattern; server-write-only.

-- ── workspace_page_filters ───────────────────────────────────────────────────
create table if not exists public.workspace_page_filters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  page_key text not null check (page_key in (
    'people','leads','qualified','calls','data','campaigns',
    'follow_up_centre','workflows','analytics','custom_people_view','custom_campaign_view'
  )),
  name text not null,
  description text,
  filter_config jsonb not null default '{"conditions":[]}'::jsonb,
  column_config jsonb not null default '[]'::jsonb,
  sort_config jsonb not null default '{}'::jsonb,
  group_config jsonb not null default '{}'::jsonb,
  visible_to_roles text[] not null default array['owner','admin','member'],
  is_default boolean not null default false,
  created_by_user_id uuid,
  created_by_systemmind boolean not null default false,
  systemmind_prompt text,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  version integer not null default 1,
  parent_filter_id uuid references public.workspace_page_filters(id),
  last_dry_run jsonb,
  last_dry_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_wpf_ws_page_status
  on public.workspace_page_filters (workspace_id, page_key, status, updated_at desc);
-- at most one default filter per page per workspace (current rows only)
create unique index if not exists idx_wpf_ws_page_default
  on public.workspace_page_filters (workspace_id, page_key)
  where is_default and status <> 'archived' and parent_filter_id is null;

-- ── campaign_reports ─────────────────────────────────────────────────────────
create table if not exists public.campaign_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid,
  agent_id uuid,
  workflow_id uuid,
  report_type text not null check (report_type in (
    'activated','failed','completed','paused','cancelled','retried','kpi_summary',
    'run_summary','safety_blocked','no_eligible_leads','provider_error','workflow_error'
  )),
  campaign_status text,
  campaign_name text,
  agent_name text,
  started_at timestamptz,
  ended_at timestamptz,
  generated_at timestamptz not null default now(),
  report_summary text,
  kpi_json jsonb not null default '{}'::jsonb,
  failure_reason text,
  failure_stage text,
  error_message text,
  recommended_actions_json jsonb not null default '[]'::jsonb,
  created_by_system boolean not null default true,
  created_by_systemmind boolean not null default false,
  visible_to_roles text[] not null default array['owner','admin','member'],
  audit_log_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_creports_ws_created
  on public.campaign_reports (workspace_id, created_at desc);
create index if not exists idx_creports_ws_campaign
  on public.campaign_reports (workspace_id, campaign_id, created_at desc);
create index if not exists idx_creports_ws_type
  on public.campaign_reports (workspace_id, report_type, created_at desc);

-- ── audit log object types: allow page_filter + campaign_report ─────────────
alter table public.workspace_view_audit_logs
  drop constraint if exists workspace_view_audit_logs_object_type_check;
alter table public.workspace_view_audit_logs
  add constraint workspace_view_audit_logs_object_type_check
  check (object_type in ('people_view','campaign_filter','page_filter','campaign_report'));

-- ── RLS: members read own workspace; writes server-only ─────────────────────
alter table public.workspace_page_filters enable row level security;
alter table public.campaign_reports enable row level security;

drop policy if exists "wpf members select" on public.workspace_page_filters;
create policy "wpf members select" on public.workspace_page_filters
  for select to authenticated
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));

drop policy if exists "creports members select" on public.campaign_reports;
create policy "creports members select" on public.campaign_reports
  for select to authenticated
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));

revoke insert, update, delete on public.workspace_page_filters from authenticated, anon;
revoke insert, update, delete on public.campaign_reports from authenticated, anon;
