-- GrowthMind Google Ads deep-analysis reports (additive, idempotent).
-- Stores the full sectioned report produced by the gads_analysis work-order
-- execution. Server-write-only: authenticated may SELECT (workspace members)
-- but never INSERT/UPDATE/DELETE — the execution adapter writes via service role.

create table if not exists public.growthmind_gads_analysis_reports (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  account_row_id uuid,
  work_order_id  uuid,
  task_id        uuid,
  execution_id   uuid,
  campaign_id    text,
  campaign_name  text,
  period_days    integer not null default 30,
  date_from      date,
  date_to        date,
  status         text not null default 'complete',
  sections       jsonb not null default '{}'::jsonb,
  source_meta    jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_gads_analysis_reports_ws_created
  on public.growthmind_gads_analysis_reports (workspace_id, created_at desc);
create index if not exists idx_gads_analysis_reports_work_order
  on public.growthmind_gads_analysis_reports (work_order_id);
create index if not exists idx_gads_analysis_reports_execution
  on public.growthmind_gads_analysis_reports (execution_id);

alter table public.growthmind_gads_analysis_reports enable row level security;

drop policy if exists "gads_analysis_reports_members_select" on public.growthmind_gads_analysis_reports;
create policy "gads_analysis_reports_members_select"
  on public.growthmind_gads_analysis_reports
  for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = growthmind_gads_analysis_reports.workspace_id
        and wm.user_id = auth.uid()
    )
  );

-- Server-write-only: strip default grants, re-grant SELECT only.
revoke all on public.growthmind_gads_analysis_reports from authenticated;
revoke all on public.growthmind_gads_analysis_reports from anon;
grant select on public.growthmind_gads_analysis_reports to authenticated;
