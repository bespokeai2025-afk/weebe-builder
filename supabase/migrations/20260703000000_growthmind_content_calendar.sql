-- ── GrowthMind Content Calendar + Growth Scheduler ──────────────────────────

-- Campaign groupings (SEO, Meta, Google, Brand, Referral, Launch, Product)
create table if not exists growthmind_growth_campaigns (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  name           text not null,
  campaign_type  text not null default 'Brand Awareness',
  description    text default '',
  start_date     date,
  end_date       date,
  budget         numeric(12,2),
  status         text not null default 'active',
  color          text default '#10b981',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Content series (recurring schedules)
create table if not exists growthmind_content_series (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  name           text not null,
  description    text default '',
  content_type   text not null default 'Blog',
  cadence        text not null default 'weekly',
  day_of_week    integer default 1,
  channel        text default '',
  is_active      boolean not null default true,
  next_date      date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Main content calendar
create table if not exists growthmind_content_calendar (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  title          text not null,
  content_type   text not null default 'Blog',
  channel        text default '',
  status         text not null default 'Draft',
  campaign_id    uuid references growthmind_growth_campaigns(id) on delete set null,
  series_id      uuid references growthmind_content_series(id) on delete set null,
  owner          text default '',
  scheduled_date timestamptz,
  description    text default '',
  notes          text default '',
  plan_id        uuid,
  sort_order     integer default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Published/scheduled content tracking
create table if not exists growthmind_scheduled_content (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  calendar_entry_id   uuid references growthmind_content_calendar(id) on delete set null,
  title               text not null,
  content_type        text not null default 'Blog',
  channel             text default '',
  published_date      timestamptz,
  external_url        text default '',
  platform_post_id    text default '',
  reach               integer default 0,
  impressions         integer default 0,
  clicks              integer default 0,
  leads_generated     integer default 0,
  notes               text default '',
  created_at          timestamptz not null default now()
);

-- Marketing task engine
create table if not exists growthmind_marketing_tasks (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  title               text not null,
  description         text default '',
  task_type           text not null default 'General',
  status              text not null default 'pending',
  priority            text not null default 'medium',
  due_date            date,
  completed_at        timestamptz,
  calendar_entry_id   uuid references growthmind_content_calendar(id) on delete set null,
  campaign_id         uuid references growthmind_growth_campaigns(id) on delete set null,
  plan_id             uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Growth scheduler plans
create table if not exists growthmind_growth_plans (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references workspaces(id) on delete cascade,
  name                  text not null,
  plan_type             text not null default '90_day',
  status                text not null default 'draft',
  business_type         text default '',
  industry              text default '',
  target_audience       text default '',
  offer                 text default '',
  monthly_budget        numeric(12,2),
  target_markets        text default '',
  keywords              text[] default '{}',
  growth_goals          text default '',
  target_leads_per_month integer default 0,
  generated_summary     text default '',
  generated_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists growthmind_calendar_workspace_date
  on growthmind_content_calendar(workspace_id, scheduled_date);

create index if not exists growthmind_calendar_workspace_status
  on growthmind_content_calendar(workspace_id, status);

create index if not exists growthmind_marketing_tasks_workspace_status
  on growthmind_marketing_tasks(workspace_id, status);

create index if not exists growthmind_marketing_tasks_workspace_due
  on growthmind_marketing_tasks(workspace_id, due_date);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table growthmind_growth_campaigns    enable row level security;
alter table growthmind_content_series      enable row level security;
alter table growthmind_content_calendar    enable row level security;
alter table growthmind_scheduled_content   enable row level security;
alter table growthmind_marketing_tasks     enable row level security;
alter table growthmind_growth_plans        enable row level security;

-- Growth campaigns
create policy "workspace_isolation" on growthmind_growth_campaigns
  using (workspace_id in (
    select workspace_id from workspace_members where user_id = auth.uid()
  ));

-- Content series
create policy "workspace_isolation" on growthmind_content_series
  using (workspace_id in (
    select workspace_id from workspace_members where user_id = auth.uid()
  ));

-- Content calendar
create policy "workspace_isolation" on growthmind_content_calendar
  using (workspace_id in (
    select workspace_id from workspace_members where user_id = auth.uid()
  ));

-- Scheduled content
create policy "workspace_isolation" on growthmind_scheduled_content
  using (workspace_id in (
    select workspace_id from workspace_members where user_id = auth.uid()
  ));

-- Marketing tasks
create policy "workspace_isolation" on growthmind_marketing_tasks
  using (workspace_id in (
    select workspace_id from workspace_members where user_id = auth.uid()
  ));

-- Growth plans
create policy "workspace_isolation" on growthmind_growth_plans
  using (workspace_id in (
    select workspace_id from workspace_members where user_id = auth.uid()
  ));
