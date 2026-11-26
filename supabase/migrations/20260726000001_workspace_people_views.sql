-- Workspace People Views + Campaign Filters + Audit Logs
-- Additive only. Workspace-scoped config; RLS = workspace_members pattern.

create table if not exists public.workspace_people_views (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  name text not null,
  slug text not null,
  description text,
  icon text,
  view_type text not null default 'people',
  filter_config jsonb not null default '{"conditions":[]}'::jsonb,
  column_config jsonb not null default '[]'::jsonb,
  sort_config jsonb not null default '{}'::jsonb,
  group_config jsonb not null default '{}'::jsonb,
  visible_to_roles text[] not null default array['owner','admin','member'],
  created_by_user_id uuid,
  created_by_systemmind boolean not null default false,
  systemmind_prompt text,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  version integer not null default 1,
  parent_view_id uuid references public.workspace_people_views(id),
  last_dry_run jsonb,
  last_dry_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_wpv_ws_status
  on public.workspace_people_views (workspace_id, status, updated_at desc);
create unique index if not exists idx_wpv_ws_slug_active
  on public.workspace_people_views (workspace_id, slug)
  where status <> 'archived' and parent_view_id is null;

create table if not exists public.workspace_campaign_filters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  name text not null,
  description text,
  filter_config jsonb not null default '{"conditions":[]}'::jsonb,
  safety_config jsonb not null default '{"excludeBooked":true,"excludeDoNotContact":true,"excludeOptedOut":true,"excludeNoPhone":true,"excludeActiveCampaign":true,"excludeCalledToday":false}'::jsonb,
  source_types text[] not null default array[]::text[],
  campaign_id uuid,
  agent_id uuid,
  visible_to_roles text[] not null default array['owner','admin','member'],
  created_by_user_id uuid,
  created_by_systemmind boolean not null default false,
  systemmind_prompt text,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  version integer not null default 1,
  parent_filter_id uuid references public.workspace_campaign_filters(id),
  last_dry_run jsonb,
  last_dry_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_wcf_ws_status
  on public.workspace_campaign_filters (workspace_id, status, updated_at desc);

create table if not exists public.workspace_view_audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid,
  object_type text not null check (object_type in ('people_view','campaign_filter')),
  object_id uuid,
  action_type text not null,
  prompt text,
  before_state jsonb,
  after_state jsonb,
  dry_run_result jsonb,
  approval_status text,
  risk_level text,
  created_at timestamptz not null default now()
);

create index if not exists idx_wval_ws_created
  on public.workspace_view_audit_logs (workspace_id, created_at desc);

-- RLS: members can read their workspace rows; writes go through server functions
-- (service role), so no insert/update/delete policies for authenticated.
alter table public.workspace_people_views enable row level security;
alter table public.workspace_campaign_filters enable row level security;
alter table public.workspace_view_audit_logs enable row level security;

drop policy if exists "wpv members select" on public.workspace_people_views;
create policy "wpv members select" on public.workspace_people_views
  for select to authenticated
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));

drop policy if exists "wcf members select" on public.workspace_campaign_filters;
create policy "wcf members select" on public.workspace_campaign_filters
  for select to authenticated
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));

drop policy if exists "wval members select" on public.workspace_view_audit_logs;
create policy "wval members select" on public.workspace_view_audit_logs
  for select to authenticated
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));

-- Server-write-only: revoke default grants from authenticated/anon for writes.
revoke insert, update, delete on public.workspace_people_views from authenticated, anon;
revoke insert, update, delete on public.workspace_campaign_filters from authenticated, anon;
revoke insert, update, delete on public.workspace_view_audit_logs from authenticated, anon;
