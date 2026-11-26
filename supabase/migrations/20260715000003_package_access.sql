-- Package-based access + chargeable staff seats (Task: package/entitlement system)
-- Additive only. Workspace-scoped; RLS = workspace_members pattern; server-write-only
-- (writes go through service_role server code). Apply via Management API or SQL Editor.

-- ── package_definitions (platform-wide catalog) ─────────────────────────────
create table if not exists public.package_definitions (
  id uuid primary key default gen_random_uuid(),
  package_key text not null unique,
  package_name text not null,
  description text,
  monthly_price integer,           -- pence; null = custom
  annual_price integer,
  currency text not null default 'GBP',
  included_voice_minutes integer not null default 0,
  included_staff_users integer not null default 1,
  max_agents integer,              -- null = unlimited
  max_workflows integer,
  max_campaigns integer,
  max_custom_views integer,
  max_page_filters integer,
  max_campaign_filters integer,
  features_json jsonb not null default '{}'::jsonb,
  page_access_json jsonb not null default '{}'::jsonb,
  action_access_json jsonb not null default '{}'::jsonb,
  ai_departments_json jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.package_definitions enable row level security;
drop policy if exists "pkg defs read" on public.package_definitions;
create policy "pkg defs read" on public.package_definitions
  for select to authenticated using (true);
revoke insert, update, delete on public.package_definitions from authenticated, anon;

-- ── workspace_subscriptions ──────────────────────────────────────────────────
create table if not exists public.workspace_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  package_key text not null,
  subscription_status text not null default 'trial'
    check (subscription_status in ('trial','active','past_due','cancelled','suspended')),
  billing_provider text,
  billing_customer_id text,
  billing_subscription_id text,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id)
);

create index if not exists idx_ws_subs_ws on public.workspace_subscriptions (workspace_id);
alter table public.workspace_subscriptions enable row level security;
drop policy if exists "ws subs members read" on public.workspace_subscriptions;
create policy "ws subs members read" on public.workspace_subscriptions
  for select to authenticated
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
revoke insert, update, delete on public.workspace_subscriptions from authenticated, anon;

-- ── workspace_addons ─────────────────────────────────────────────────────────
create table if not exists public.workspace_addons (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  addon_key text not null,
  addon_name text not null,
  quantity integer not null default 1 check (quantity >= 0),
  status text not null default 'pending'
    check (status in ('active','pending','cancelled','suspended')),
  billing_provider text,
  billing_subscription_item_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, addon_key)
);

create index if not exists idx_ws_addons_ws on public.workspace_addons (workspace_id);
alter table public.workspace_addons enable row level security;
drop policy if exists "ws addons members read" on public.workspace_addons;
create policy "ws addons members read" on public.workspace_addons
  for select to authenticated
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
revoke insert, update, delete on public.workspace_addons from authenticated, anon;

-- ── workspace_feature_entitlements ───────────────────────────────────────────
create table if not exists public.workspace_feature_entitlements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source text not null default 'package' check (source in ('package','addon','admin_override')),
  feature_key text not null,
  enabled boolean not null default true,
  limit_value integer,
  used_value integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, feature_key, source)
);

create index if not exists idx_ws_feat_ws on public.workspace_feature_entitlements (workspace_id);
alter table public.workspace_feature_entitlements enable row level security;
drop policy if exists "ws feats members read" on public.workspace_feature_entitlements;
create policy "ws feats members read" on public.workspace_feature_entitlements
  for select to authenticated
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
revoke insert, update, delete on public.workspace_feature_entitlements from authenticated, anon;

-- ── workspace_user_access_overrides ──────────────────────────────────────────
create table if not exists public.workspace_user_access_overrides (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  page_access_json jsonb not null default '{}'::jsonb,
  action_access_json jsonb not null default '{}'::jsonb,
  field_visibility_json jsonb not null default '{}'::jsonb,
  panel_visibility_json jsonb not null default '{}'::jsonb,
  record_visibility_json jsonb not null default '{}'::jsonb,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index if not exists idx_ws_uao_ws on public.workspace_user_access_overrides (workspace_id);
alter table public.workspace_user_access_overrides enable row level security;
drop policy if exists "ws uao members read" on public.workspace_user_access_overrides;
create policy "ws uao members read" on public.workspace_user_access_overrides
  for select to authenticated
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
revoke insert, update, delete on public.workspace_user_access_overrides from authenticated, anon;
