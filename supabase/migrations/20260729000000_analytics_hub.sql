-- Analytics Hub: stored analytics reports + report schedules.
-- Additive & idempotent. Apply via Supabase Management API (shared dev/prod DB).

create table if not exists public.analytics_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  report_type text not null,
  report_name text not null,
  report_status text not null default 'generated', -- draft|generated|sent|failed
  related_campaign_id uuid,
  related_agent_id uuid,
  related_workflow_id uuid,
  date_range_start timestamptz,
  date_range_end timestamptz,
  report_summary text,
  metrics_json jsonb not null default '{}'::jsonb,
  insights_json jsonb not null default '[]'::jsonb,
  recommendations_json jsonb not null default '[]'::jsonb,
  generated_by text not null default 'system', -- system|systemmind|hivemind|growthmind|accountsmind|user
  created_by_user_id uuid,
  sent_to_json jsonb not null default '[]'::jsonb,
  delivery_status text, -- null|queued|sent|failed
  delivery_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_analytics_reports_ws_created
  on public.analytics_reports (workspace_id, created_at desc);
create index if not exists idx_analytics_reports_ws_type
  on public.analytics_reports (workspace_id, report_type, created_at desc);
create index if not exists idx_analytics_reports_campaign
  on public.analytics_reports (related_campaign_id) where related_campaign_id is not null;

create table if not exists public.analytics_report_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  report_type text not null,
  name text not null,
  frequency text not null default 'weekly', -- daily|weekly|monthly|custom
  schedule_config_json jsonb not null default '{}'::jsonb,
  recipients_json jsonb not null default '[]'::jsonb,
  filters_json jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_error text,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_analytics_report_schedules_ws
  on public.analytics_report_schedules (workspace_id, enabled);

-- RLS: members can read their workspace rows; all writes go through server
-- code (service_role). Default grants give authenticated ALL — revoke writes.
alter table public.analytics_reports enable row level security;
alter table public.analytics_report_schedules enable row level security;

revoke insert, update, delete on public.analytics_reports from authenticated, anon;
revoke insert, update, delete on public.analytics_report_schedules from authenticated, anon;

drop policy if exists "analytics_reports members read" on public.analytics_reports;
create policy "analytics_reports members read"
  on public.analytics_reports for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = analytics_reports.workspace_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists "analytics_report_schedules members read" on public.analytics_report_schedules;
create policy "analytics_report_schedules members read"
  on public.analytics_report_schedules for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = analytics_report_schedules.workspace_id
        and m.user_id = auth.uid()
    )
  );
