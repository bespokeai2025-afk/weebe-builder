-- Auto SEO campaign cadence: how many SEO blog campaigns GrowthMind may
-- auto-create per week for a workspace (0 = off). Approval-first: campaigns
-- created by the tick still require human approval at every stage.
alter table public.workspace_settings
  add column if not exists seo_auto_campaigns_per_week integer not null default 0;

-- CAS claim column: concurrent executor ticks race on this timestamp so only
-- one instance can create the next auto campaign (min-gap enforced in the
-- same atomic UPDATE).
alter table public.workspace_settings
  add column if not exists seo_auto_last_created_at timestamptz;
