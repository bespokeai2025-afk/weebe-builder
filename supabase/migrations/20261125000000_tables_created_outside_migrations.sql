-- Tables and columns production has that no migration created (they were made in the SQL editor).
-- Generated from src/integrations/supabase/types.ts so a fresh database matches production; on a
-- database that already has them every statement here does nothing. New tables are
-- server-only (RLS on, no policies), like the other GrowthMind/WBAH tables the server writes.

create table if not exists public.growthmind_domain_warmups (
  id uuid primary key default gen_random_uuid(),
  bounce_rate numeric,
  completed_days numeric[] not null default '{}',
  created_at timestamptz not null default now(),
  current_day integer not null default 0,
  daily_plan jsonb not null default '{}'::jsonb,
  domain text not null,
  from_email text not null,
  notes text,
  phase numeric not null default 0,
  reputation_score numeric,
  spam_rate numeric,
  started_at timestamptz not null default now(),
  status text not null default '',
  total_days numeric not null default 0,
  updated_at timestamptz not null default now(),
  workspace_id uuid not null
);
create index if not exists growthmind_domain_warmups_workspace_id_idx on public.growthmind_domain_warmups (workspace_id);
alter table public.growthmind_domain_warmups enable row level security;
revoke all on public.growthmind_domain_warmups from anon, authenticated;

create table if not exists public.growthmind_email_campaigns (
  id uuid primary key default gen_random_uuid(),
  ai_model text,
  audience jsonb not null default '{}'::jsonb,
  body_html text not null default '',
  body_text text not null default '',
  created_at timestamptz not null default now(),
  cta_label text,
  cta_url text,
  from_email text,
  from_name text,
  generated_by_ai boolean not null default false,
  name text not null,
  preview_text text not null default '',
  recipient_count numeric,
  scheduled_at timestamptz,
  send_result jsonb,
  sent_at timestamptz,
  status text not null default '',
  subject text not null default '',
  updated_at timestamptz not null default now(),
  workspace_id uuid not null
);
create index if not exists growthmind_email_campaigns_workspace_id_idx on public.growthmind_email_campaigns (workspace_id);
alter table public.growthmind_email_campaigns enable row level security;
revoke all on public.growthmind_email_campaigns from anon, authenticated;

create table if not exists public.growthmind_seo_briefs (
  id uuid primary key default gen_random_uuid(),
  brief jsonb not null,
  created_at timestamptz not null default now(),
  generated_at timestamptz not null default now(),
  meta_desc text,
  meta_title text,
  page_title text,
  score integer,
  target_kws text[] not null default '{}',
  url text not null,
  word_count numeric,
  workspace_id uuid not null
);
create index if not exists growthmind_seo_briefs_workspace_id_idx on public.growthmind_seo_briefs (workspace_id);
alter table public.growthmind_seo_briefs enable row level security;
revoke all on public.growthmind_seo_briefs from anon, authenticated;

create table if not exists public.growthmind_service_scores (
  id uuid primary key default gen_random_uuid(),
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  recommendation text,
  scores jsonb not null default '{}'::jsonb,
  service_name text not null,
  total_score numeric not null default 0,
  workspace_id uuid not null
);
create index if not exists growthmind_service_scores_workspace_id_idx on public.growthmind_service_scores (workspace_id);
alter table public.growthmind_service_scores enable row level security;
revoke all on public.growthmind_service_scores from anon, authenticated;

create table if not exists public.growthmind_trend_signals (
  id uuid primary key default gen_random_uuid(),
  action_hint text,
  change_percent numeric,
  classification text not null,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  current_value numeric not null default 0,
  insight text,
  label text not null,
  previous_value numeric not null default 0,
  signal_type text not null,
  workspace_id uuid not null
);
create index if not exists growthmind_trend_signals_workspace_id_idx on public.growthmind_trend_signals (workspace_id);
alter table public.growthmind_trend_signals enable row level security;
revoke all on public.growthmind_trend_signals from anon, authenticated;

create table if not exists public.growthmind_video_proposals (
  id uuid primary key default gen_random_uuid(),
  call_to_action text,
  created_at timestamptz not null default now(),
  creative_angles text[] not null default '{}',
  duration text,
  expected_outcome text,
  generated_at timestamptz not null default now(),
  hook text,
  platform text,
  status text not null default '',
  storyboard jsonb,
  target_audience text,
  title text not null,
  workspace_id uuid not null
);
create index if not exists growthmind_video_proposals_workspace_id_idx on public.growthmind_video_proposals (workspace_id);
alter table public.growthmind_video_proposals enable row level security;
revoke all on public.growthmind_video_proposals from anon, authenticated;

create table if not exists public.wbah_categorized_leads (
  id uuid primary key default gen_random_uuid(),
  address text,
  city text,
  created_at timestamptz,
  email text,
  external_lead_id text not null,
  external_source text not null default '',
  external_status_code text,
  external_status_label text,
  first_name text,
  full_name text,
  last_name text,
  last_synced_at timestamptz,
  meta jsonb,
  phone text,
  postcode text,
  property_type text,
  webee_category text not null,
  workspace_id uuid not null
);
create index if not exists wbah_categorized_leads_workspace_id_idx on public.wbah_categorized_leads (workspace_id);
alter table public.wbah_categorized_leads enable row level security;
revoke all on public.wbah_categorized_leads from anon, authenticated;

create table if not exists public.wbah_category_sync_log (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  duration_ms integer,
  endpoint_used text,
  error_message text,
  external_status_codes text[],
  failed integer,
  imported numeric,
  skipped numeric,
  synced_at timestamptz,
  total_records numeric,
  updated numeric,
  workspace_id uuid not null
);
create index if not exists wbah_category_sync_log_workspace_id_idx on public.wbah_category_sync_log (workspace_id);
alter table public.wbah_category_sync_log enable row level security;
revoke all on public.wbah_category_sync_log from anon, authenticated;

alter table public.campaigns
  add column if not exists phone_number_id uuid,
  add column if not exists retry_config jsonb,
  add column if not exists schedule_config jsonb,
  add column if not exists stats jsonb,
  add column if not exists targets jsonb not null default '{}'::jsonb;

alter table public.client_billing_profiles
  add column if not exists billing_address text not null default '';

alter table public.dialer_targets
  add column if not exists error_message text;

alter table public.profiles
  add column if not exists retell_go_live_override boolean not null default false,
  add column if not exists retell_live_enabled boolean not null default false,
  add column if not exists retell_production_api_key text,
  add column if not exists retell_provisioned_at timestamptz,
  add column if not exists retell_workspace_external_id text;

alter table public.wbah_crm_contacts
  add column if not exists full_name text,
  add column if not exists lead_origin text,
  add column if not exists origin_provider text;

alter table public.workspace_settings
  add column if not exists elevenlabs_api_key text,
  add column if not exists openai_api_key text,
  add column if not exists push_tokens jsonb not null default '{}'::jsonb;
