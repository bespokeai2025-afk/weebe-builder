-- hexmail_campaign_enrollments
-- Tracks which leads are enrolled in which follow-up campaigns and where they are in the sequence.

create table if not exists public.hexmail_campaign_enrollments (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  campaign_id    uuid not null references public.hexmail_campaigns(id) on delete cascade,
  lead_id        uuid not null references public.leads(id) on delete cascade,
  enrolled_at    timestamptz not null default now(),
  status         text not null default 'active' check (status in ('active','paused','completed','cancelled')),
  current_day    integer not null default 1,
  last_executed  timestamptz,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (campaign_id, lead_id)
);

alter table public.hexmail_campaign_enrollments enable row level security;

create policy "workspace members can manage enrollments"
  on public.hexmail_campaign_enrollments
  for all
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid()
    )
  );

create index on public.hexmail_campaign_enrollments (workspace_id, status);
create index on public.hexmail_campaign_enrollments (campaign_id);
create index on public.hexmail_campaign_enrollments (lead_id);
