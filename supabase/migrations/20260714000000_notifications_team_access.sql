-- Campaign Notifications & Team Access (RBAC)
-- Additive only. Workspace-scoped; RLS = workspace_members pattern; server-write-only
-- for notification/permission tables (writes go through service_role server code).

-- ── workspace_notification_settings ─────────────────────────────────────────
create table if not exists public.workspace_notification_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  event_key text not null check (event_key in (
    'launched','activated','paused','completed','failed','safety_blocked',
    'no_eligible_leads','daily_cap_hit','safety_cap_hit','provider_error',
    'workflow_error','kpi_report_ready','high_negative_sentiment',
    'high_positive_performance','qualified_leads_generated',
    'appointments_booked','follow_up_tasks_created','needs_admin_attention'
  )),
  enabled boolean not null default true,
  email_enabled boolean not null default false,
  in_app_enabled boolean not null default true,
  recipients jsonb not null default '{"owner":true,"admins":true,"userIds":[],"roleKeys":[],"customEmails":[],"campaignOwner":false}'::jsonb,
  frequency text not null default 'immediate' check (frequency in ('immediate','hourly','daily','weekly')),
  updated_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, event_key)
);

create index if not exists idx_wns_ws on public.workspace_notification_settings (workspace_id);

alter table public.workspace_notification_settings enable row level security;
drop policy if exists "wns members read" on public.workspace_notification_settings;
create policy "wns members read" on public.workspace_notification_settings
  for select to authenticated
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
revoke insert, update, delete on public.workspace_notification_settings from authenticated, anon;

-- ── workspace_notifications ─────────────────────────────────────────────────
create table if not exists public.workspace_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  event_key text not null,
  campaign_id uuid,
  report_id uuid,
  object_type text,
  object_id text,
  title text not null,
  message text,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  channel text not null default 'in_app' check (channel in ('in_app','email')),
  recipient_user_id uuid,
  recipient_email text,
  delivery_status text not null default 'pending' check (delivery_status in ('pending','sent','failed','skipped','digest_queued')),
  delivery_error text,
  read_at timestamptz,
  sent_at timestamptz,
  digest_frequency text,
  created_at timestamptz not null default now()
);

create index if not exists idx_wn_ws_created on public.workspace_notifications (workspace_id, created_at desc);
create index if not exists idx_wn_ws_channel_status on public.workspace_notifications (workspace_id, channel, delivery_status);
create index if not exists idx_wn_digest on public.workspace_notifications (delivery_status, digest_frequency) where delivery_status = 'digest_queued';

alter table public.workspace_notifications enable row level security;
drop policy if exists "wn members read" on public.workspace_notifications;
create policy "wn members read" on public.workspace_notifications
  for select to authenticated
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
revoke insert, update, delete on public.workspace_notifications from authenticated, anon;

-- ── workspace_role_permissions ───────────────────────────────────────────────
-- Per-workspace overrides of the code-level role defaults. role_key is open text
-- so workspaces can define custom roles (e.g. sales_manager) on top of the
-- built-ins: owner, admin, manager, agent_builder, campaign_manager,
-- reports_only, viewer, suspended.
create table if not exists public.workspace_role_permissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  role_key text not null,
  display_name text,
  page_access jsonb not null default '{}'::jsonb,
  action_access jsonb not null default '{}'::jsonb,
  assigned_records_only boolean not null default false,
  is_system_default boolean not null default false,
  updated_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, role_key)
);

create index if not exists idx_wrp_ws on public.workspace_role_permissions (workspace_id);

alter table public.workspace_role_permissions enable row level security;
drop policy if exists "wrp members read" on public.workspace_role_permissions;
create policy "wrp members read" on public.workspace_role_permissions
  for select to authenticated
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
revoke insert, update, delete on public.workspace_role_permissions from authenticated, anon;

-- ── workspace_member_roles (extended role assignment per member) ────────────
-- Existing workspace_members.role enum (owner/admin/member) is untouched; this
-- table layers the extended RBAC role on top. Absent row = mapped default.
create table if not exists public.workspace_member_roles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid not null,
  role_key text not null,
  assigned_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index if not exists idx_wmr_ws on public.workspace_member_roles (workspace_id);

alter table public.workspace_member_roles enable row level security;
drop policy if exists "wmr members read" on public.workspace_member_roles;
create policy "wmr members read" on public.workspace_member_roles
  for select to authenticated
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
revoke insert, update, delete on public.workspace_member_roles from authenticated, anon;

-- ── workspace_approval_settings (who approves high-risk actions) ────────────
create table if not exists public.workspace_approval_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique,
  settings jsonb not null default '{}'::jsonb,
  updated_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workspace_approval_settings enable row level security;
drop policy if exists "was members read" on public.workspace_approval_settings;
create policy "was members read" on public.workspace_approval_settings
  for select to authenticated
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
revoke insert, update, delete on public.workspace_approval_settings from authenticated, anon;

-- ── workspace_access_audit_logs ──────────────────────────────────────────────
create table if not exists public.workspace_access_audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  acting_user_id uuid,
  target_user_id uuid,
  object_type text not null,
  object_id text,
  action_type text not null,
  before_state jsonb,
  after_state jsonb,
  risk_level text not null default 'low' check (risk_level in ('low','medium','high')),
  created_at timestamptz not null default now()
);

create index if not exists idx_waal_ws_created on public.workspace_access_audit_logs (workspace_id, created_at desc);

alter table public.workspace_access_audit_logs enable row level security;
drop policy if exists "waal members read" on public.workspace_access_audit_logs;
create policy "waal members read" on public.workspace_access_audit_logs
  for select to authenticated
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
revoke insert, update, delete on public.workspace_access_audit_logs from authenticated, anon;

-- ── workspace_invites: carry extended role key (enum column untouched) ──────
alter table public.workspace_invites
  add column if not exists invited_role_key text;
