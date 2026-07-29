-- Task #489: Content Studio cross-channel variants.
-- One content project can now fan out into MANY per-channel adapted variants,
-- each independently approvable with an honest deployment state.
-- Additive + idempotent — safe to re-run.

create table if not exists public.growthmind_content_variants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null references public.growthmind_content_projects(id) on delete cascade,
  work_order_id uuid,
  channel text not null,
  -- Adapted (never identical) channel copy
  headline text,
  body_copy text,
  caption text,
  cta text,
  hook text,
  script text,
  media_url text,
  format_notes text,
  -- Approval (per-channel, split from every other variant)
  approval_state text not null default 'draft',
  approval_task_id uuid,
  approved_at timestamptz,
  approved_by uuid,
  approved_copy_snapshot jsonb,
  -- Honest deployment state machine
  deployment_state text not null default 'draft',
  deployment_path text not null default 'manual', -- 'api' | 'manual'
  publishing_job_id uuid,
  external_post_id text,
  live_url text,
  provider_record jsonb,
  verification_note text,
  blockers jsonb not null default '[]'::jsonb,
  performance jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gm_content_variants_channel_chk check (channel in (
    'blog','meta_ad','fb_post','ig_post','ig_story','ig_reel','tiktok',
    'linkedin_post','linkedin_ad','whatsapp','email','sms','landing'
  )),
  constraint gm_content_variants_deploy_chk check (deployment_state in (
    'draft','awaiting_channel_approval','approved','publishing','published',
    'verification_failed','monitoring','awaiting_manual_publication','blocked'
  )),
  constraint gm_content_variants_path_chk check (deployment_path in ('api','manual'))
);

create index if not exists idx_gm_content_variants_ws
  on public.growthmind_content_variants (workspace_id, updated_at desc);
create index if not exists idx_gm_content_variants_project
  on public.growthmind_content_variants (project_id);
create unique index if not exists uq_gm_content_variants_project_channel
  on public.growthmind_content_variants (project_id, channel);

alter table public.growthmind_content_variants enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'growthmind_content_variants'
      and policyname = 'gm_content_variants_members_select'
  ) then
    create policy gm_content_variants_members_select on public.growthmind_content_variants
      for select to authenticated
      using (exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = growthmind_content_variants.workspace_id
          and wm.user_id = auth.uid()
      ));
  end if;
end $$;

-- Server-write-only: writes go through service-role server code (approval &
-- deployment transitions are audited there). Revoke default write grants.
revoke insert, update, delete on public.growthmind_content_variants from authenticated;
revoke all on public.growthmind_content_variants from anon;
