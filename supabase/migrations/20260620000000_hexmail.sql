-- HexMail Follow-Up Centre + Template Studio
-- Tables: hexmail_templates, hexmail_campaigns, hexmail_campaign_steps

-- ── Templates ────────────────────────────────────────────────────────────────
create table if not exists public.hexmail_templates (
  id          uuid        primary key default gen_random_uuid(),
  workspace_id uuid       not null,
  name        text        not null,
  type        text        not null,
  subject     text,
  content     text        not null default '',
  status      text        not null default 'active',
  usage_count integer     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint hexmail_templates_type_check
    check (type in ('email','sms','whatsapp','document','proposal','quote','invoice','contract')),
  constraint hexmail_templates_status_check
    check (status in ('active','archived'))
);

alter table public.hexmail_templates enable row level security;

drop policy if exists "workspace members manage hexmail_templates" on public.hexmail_templates;
create policy "workspace members manage hexmail_templates"
  on public.hexmail_templates for all
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid()
    )
  );

-- ── Campaigns ────────────────────────────────────────────────────────────────
create table if not exists public.hexmail_campaigns (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null,
  name         text        not null,
  description  text,
  status       text        not null default 'draft',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint hexmail_campaigns_status_check
    check (status in ('draft','active','paused','archived'))
);

alter table public.hexmail_campaigns enable row level security;

drop policy if exists "workspace members manage hexmail_campaigns" on public.hexmail_campaigns;
create policy "workspace members manage hexmail_campaigns"
  on public.hexmail_campaigns for all
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid()
    )
  );

-- ── Campaign Steps (one row per day) ─────────────────────────────────────────
create table if not exists public.hexmail_campaign_steps (
  id          uuid        primary key default gen_random_uuid(),
  campaign_id uuid        not null references public.hexmail_campaigns(id) on delete cascade,
  day_number  integer     not null,
  actions     jsonb       not null default '[]',
  created_at  timestamptz not null default now(),
  constraint hexmail_campaign_steps_day_unique unique(campaign_id, day_number)
);

alter table public.hexmail_campaign_steps enable row level security;

drop policy if exists "workspace members manage hexmail_campaign_steps" on public.hexmail_campaign_steps;
create policy "workspace members manage hexmail_campaign_steps"
  on public.hexmail_campaign_steps for all
  using (
    campaign_id in (
      select id from public.hexmail_campaigns hc
      where hc.workspace_id in (
        select workspace_id from public.workspace_members
        where user_id = auth.uid()
      )
    )
  );
