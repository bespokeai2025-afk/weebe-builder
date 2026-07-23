-- GrowthMind Google Ads live activation (Task: repair + upgrade existing integration)
-- Additive & idempotent only — dev/prod share this database.

-- ── Account selection / connection-state columns on the existing accounts table ──
alter table public.growthmind_ads_accounts add column if not exists customer_id          text;
alter table public.growthmind_ads_accounts add column if not exists login_customer_id    text;
alter table public.growthmind_ads_accounts add column if not exists descriptive_name     text;
alter table public.growthmind_ads_accounts add column if not exists currency_code        text;
alter table public.growthmind_ads_accounts add column if not exists time_zone            text;
alter table public.growthmind_ads_accounts add column if not exists connection_state     text; -- oauth_connected | api_verified | account_selected | sync_healthy | needs_reconnect
alter table public.growthmind_ads_accounts add column if not exists accessible_customers jsonb;
alter table public.growthmind_ads_accounts add column if not exists sync_config          jsonb;

-- ── Structured sync runs ──────────────────────────────────────────────────────
create table if not exists public.growthmind_gads_sync_runs (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  account_row_id uuid not null,
  run_type       text not null default 'incremental',  -- initial | incremental | historical | manual
  status         text not null default 'running',      -- running | success | partial | error
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  campaigns_synced integer not null default 0,
  rows_upserted    integer not null default 0,
  spend_synced     numeric not null default 0,
  error_message  text,
  stats          jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists gads_sync_runs_ws_started_idx
  on public.growthmind_gads_sync_runs (workspace_id, started_at desc);
create index if not exists gads_sync_runs_acct_status_idx
  on public.growthmind_gads_sync_runs (account_row_id, status, started_at desc);

-- ── Campaign daily metrics (date-segmented, incremental upserts) ──────────────
create table if not exists public.growthmind_gads_campaign_daily (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  account_row_id    uuid not null,
  customer_id       text not null,
  campaign_id       text not null,
  date              date not null,
  name              text not null,
  status            text,
  channel_type      text,
  budget_micros     bigint,
  cost_micros       bigint not null default 0,
  impressions       bigint not null default 0,
  clicks            bigint not null default 0,
  conversions       numeric not null default 0,
  conversions_value numeric not null default 0,
  updated_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  unique (workspace_id, customer_id, campaign_id, date)
);
create index if not exists gads_campaign_daily_ws_date_idx
  on public.growthmind_gads_campaign_daily (workspace_id, date desc);
create index if not exists gads_campaign_daily_ws_campaign_idx
  on public.growthmind_gads_campaign_daily (workspace_id, campaign_id, date desc);

-- ── Supporting entity stats (ad groups / keywords / search terms / device / location) ──
create table if not exists public.growthmind_gads_dimension_stats (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  account_row_id    uuid not null,
  customer_id       text not null,
  campaign_id       text not null,
  entity_type       text not null check (entity_type in ('ad_group','keyword','search_term','device','location','ad')),
  entity_key        text not null,
  label             text,
  date_start        date not null,
  date_end          date not null,
  cost_micros       bigint not null default 0,
  impressions       bigint not null default 0,
  clicks            bigint not null default 0,
  conversions       numeric not null default 0,
  conversions_value numeric not null default 0,
  meta              jsonb,
  updated_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  unique (workspace_id, customer_id, campaign_id, entity_type, entity_key, date_start)
);
create index if not exists gads_dimension_stats_ws_camp_idx
  on public.growthmind_gads_dimension_stats (workspace_id, campaign_id, entity_type);

-- ── GrowthMind recommendations (approval-gated; NEVER auto-applied) ───────────
create table if not exists public.growthmind_gads_recommendations (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null,
  account_row_id     uuid not null,
  customer_id        text,
  campaign_id        text,
  campaign_name      text,
  section            text not null check (section in ('immediate_attention','wasted_spend','budget_opportunity','growth','conversion','tracking_quality')),
  priority           text not null default 'medium' check (priority in ('critical','high','medium','low')),
  confidence         numeric not null default 0.5,
  title              text not null,
  evidence           jsonb,             -- metric snapshots backing the recommendation
  expected_benefit   text,
  recommended_action text not null,
  status             text not null default 'new' check (status in ('new','under_review','approved','rejected','dismissed','applied','expired')),
  dedupe_key         text,              -- stable key so re-analysis updates instead of duplicating
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  expires_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (workspace_id, dedupe_key)
);
create index if not exists gads_recs_ws_status_idx
  on public.growthmind_gads_recommendations (workspace_id, status, priority);

-- ── Change requests created on approval (executor intentionally NOT built) ────
create table if not exists public.growthmind_gads_change_requests (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  recommendation_id uuid references public.growthmind_gads_recommendations (id) on delete set null,
  account_row_id    uuid not null,
  customer_id       text,
  campaign_id       text,
  change_type       text not null,
  payload           jsonb,
  status            text not null default 'approved' check (status in ('approved','cancelled','executed')),
  approved_by       uuid,
  approved_at       timestamptz not null default now(),
  executed_at       timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists gads_change_requests_ws_idx
  on public.growthmind_gads_change_requests (workspace_id, status, created_at desc);

-- ── RLS: members read; all writes are server-side (service_role) only ─────────
alter table public.growthmind_gads_sync_runs        enable row level security;
alter table public.growthmind_gads_campaign_daily   enable row level security;
alter table public.growthmind_gads_dimension_stats  enable row level security;
alter table public.growthmind_gads_recommendations  enable row level security;
alter table public.growthmind_gads_change_requests  enable row level security;

drop policy if exists "gads_sync_runs_members_read" on public.growthmind_gads_sync_runs;
create policy "gads_sync_runs_members_read"
  on public.growthmind_gads_sync_runs for select to authenticated
  using (exists (select 1 from public.workspace_members m
                 where m.workspace_id = growthmind_gads_sync_runs.workspace_id
                   and m.user_id = auth.uid()));

drop policy if exists "gads_campaign_daily_members_read" on public.growthmind_gads_campaign_daily;
create policy "gads_campaign_daily_members_read"
  on public.growthmind_gads_campaign_daily for select to authenticated
  using (exists (select 1 from public.workspace_members m
                 where m.workspace_id = growthmind_gads_campaign_daily.workspace_id
                   and m.user_id = auth.uid()));

drop policy if exists "gads_dimension_stats_members_read" on public.growthmind_gads_dimension_stats;
create policy "gads_dimension_stats_members_read"
  on public.growthmind_gads_dimension_stats for select to authenticated
  using (exists (select 1 from public.workspace_members m
                 where m.workspace_id = growthmind_gads_dimension_stats.workspace_id
                   and m.user_id = auth.uid()));

drop policy if exists "gads_recommendations_members_read" on public.growthmind_gads_recommendations;
create policy "gads_recommendations_members_read"
  on public.growthmind_gads_recommendations for select to authenticated
  using (exists (select 1 from public.workspace_members m
                 where m.workspace_id = growthmind_gads_recommendations.workspace_id
                   and m.user_id = auth.uid()));

drop policy if exists "gads_change_requests_members_read" on public.growthmind_gads_change_requests;
create policy "gads_change_requests_members_read"
  on public.growthmind_gads_change_requests for select to authenticated
  using (exists (select 1 from public.workspace_members m
                 where m.workspace_id = growthmind_gads_change_requests.workspace_id
                   and m.user_id = auth.uid()));

-- Default grants give authenticated ALL — revoke writes explicitly.
revoke insert, update, delete on public.growthmind_gads_sync_runs        from authenticated, anon;
revoke insert, update, delete on public.growthmind_gads_campaign_daily   from authenticated, anon;
revoke insert, update, delete on public.growthmind_gads_dimension_stats  from authenticated, anon;
revoke insert, update, delete on public.growthmind_gads_recommendations  from authenticated, anon;
revoke insert, update, delete on public.growthmind_gads_change_requests  from authenticated, anon;
