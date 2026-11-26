-- WBAH dialler campaign reporting: campaign snapshot + run tracking.
-- Snapshot is refreshed opportunistically whenever the WBAH campaigns page
-- does a live WeeBespoke read (never by background polling — WeeBespoke is
-- single-session and background logins kick the human admin out).

create table if not exists public.wbah_campaign_snapshot (
  id            text primary key,               -- WeeBespoke campaign uuid
  workspace_id  uuid not null,
  name          text not null,
  status        text,
  agent_id      text,
  lead_status   text,
  call_hour     integer,
  call_minute   integer,
  timezone      text default 'Europe/London',
  frequency     text,
  interval_days integer,
  is_active     boolean default true,
  is_deleted    boolean default false,
  raw           jsonb,
  synced_at     timestamptz not null default now()
);

create index if not exists wbah_campaign_snapshot_ws_idx
  on public.wbah_campaign_snapshot (workspace_id);

create table if not exists public.wbah_campaign_runs (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  campaign_id      text not null,
  campaign_name    text,
  agent_id         text,
  run_date         date not null,
  window_start     timestamptz not null,
  window_end       timestamptz,
  status           text not null default 'running',  -- running | finished
  kpis             jsonb,
  start_report_id  uuid,
  end_report_id    uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (campaign_id, run_date)
);

create index if not exists wbah_campaign_runs_ws_status_idx
  on public.wbah_campaign_runs (workspace_id, status);

-- RLS: members may read; ALL writes are server-side (service_role) only.
alter table public.wbah_campaign_snapshot enable row level security;
alter table public.wbah_campaign_runs enable row level security;

drop policy if exists "wbah_campaign_snapshot_members_read" on public.wbah_campaign_snapshot;
create policy "wbah_campaign_snapshot_members_read"
  on public.wbah_campaign_snapshot for select to authenticated
  using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = wbah_campaign_snapshot.workspace_id
      and m.user_id = auth.uid()
  ));

drop policy if exists "wbah_campaign_runs_members_read" on public.wbah_campaign_runs;
create policy "wbah_campaign_runs_members_read"
  on public.wbah_campaign_runs for select to authenticated
  using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = wbah_campaign_runs.workspace_id
      and m.user_id = auth.uid()
  ));

-- Default grants give authenticated ALL — revoke writes explicitly.
revoke insert, update, delete on public.wbah_campaign_snapshot from authenticated, anon;
revoke insert, update, delete on public.wbah_campaign_runs from authenticated, anon;
