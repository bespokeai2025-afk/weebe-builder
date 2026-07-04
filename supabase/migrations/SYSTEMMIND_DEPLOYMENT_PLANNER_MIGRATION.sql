-- ── SystemMind Deployment Planner & Intelligence (Task #298) ──────────────────
-- Apply MANUALLY in the Supabase SQL Editor (Dashboard → SQL Editor → Run).
-- Strictly ADDITIVE. Idempotent: every statement uses IF NOT EXISTS / guards.
--
-- Builds on the #297 Template Library + Knowledge Graph + CRM abstraction:
--   (A) systemmind_template_confidence  — per-template multi-dimensional scoring.
--   (B) systemmind_deployment_plans     — assembled, DESCRIPTIVE deployment plans.
--   (C) systemmind_intelligence_settings — per-workspace confidence threshold +
--       the (disabled) autonomous-deployment flag.
--
-- DESCRIPTIVE / PLAN-ONLY. Nothing here deploys, provisions, or executes anything.
-- Autonomous deployment stays DISABLED (autonomous_deployment_enabled default
-- false) and there is no server-side write path that flips it on.
-- Deployment plans are stored with execution_status = 'not_executed' and that
-- value is never updated — a human operator must execute every step out-of-band.
-- Secrets are NEVER stored: confidence scores and plans reference deployment
-- variable KEYS/labels only, never raw values.

-- ── (A) Per-template confidence scores ────────────────────────────────────────
create table if not exists public.systemmind_template_confidence (
  id                       uuid        primary key default gen_random_uuid(),
  workspace_id             uuid        not null references public.workspaces(id) on delete cascade,
  template_id              uuid        not null references public.systemmind_workflow_templates(id) on delete cascade,

  -- ── Dimension scores (0-100) ───────────────────────────────────────────────
  understanding            integer     not null default 0,
  documentation            integer     not null default 0,
  reuse                    integer     not null default 0,
  crm_portability          integer     not null default 0,
  deployment_readiness     integer     not null default 0,
  dependency               integer     not null default 0,

  -- ── Aggregate ──────────────────────────────────────────────────────────────
  overall_score            integer     not null default 0,          -- weighted 0-100
  risk_rating              text        not null default 'medium',    -- low | medium | high
  signals                  jsonb       not null default '{}'::jsonb, -- { <dim>: { score, notes[] } }

  -- ── Staleness tracking ─────────────────────────────────────────────────────
  -- `recommended` is intentionally NOT stored: it is derived at read time from
  -- overall_score vs the workspace's current confidence_threshold, so it can
  -- never go stale when the threshold changes. template_current_version lets the
  -- UI flag a score as stale after the template is edited.
  template_current_version integer     not null default 1,
  computed_at              timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (template_id)
);
create index if not exists sm_conf_ws_idx  on public.systemmind_template_confidence (workspace_id, overall_score desc);
create index if not exists sm_conf_tpl_idx on public.systemmind_template_confidence (template_id);

-- ── (B) Assembled deployment plans (descriptive; never executed) ──────────────
create table if not exists public.systemmind_deployment_plans (
  id                    uuid        primary key default gen_random_uuid(),
  workspace_id          uuid        not null references public.workspaces(id) on delete cascade,

  request_text          text        not null,
  title                 text,
  status                text        not null default 'draft',        -- draft | planned | archived
  -- Trust/safety anchor: a stored plan is ALWAYS non-executed. There is no
  -- server code path that updates this column — autonomous deployment is off.
  execution_status      text        not null default 'not_executed', -- always 'not_executed'

  plan                  jsonb       not null default '{}'::jsonb,     -- full descriptive plan (keys/labels only, no secret values)
  required_template_ids uuid[]      not null default '{}',
  confidence            integer,                                     -- 0-100 (avg of selected template scores)
  risk_rating           text,                                        -- low | medium | high
  estimated_minutes     integer,
  generated_by          text        not null default 'ai',           -- ai | heuristic

  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists sm_plan_ws_idx     on public.systemmind_deployment_plans (workspace_id, updated_at desc);
create index if not exists sm_plan_status_idx on public.systemmind_deployment_plans (workspace_id, status);

-- ── (C) Per-workspace intelligence settings ───────────────────────────────────
create table if not exists public.systemmind_intelligence_settings (
  id                            uuid        primary key default gen_random_uuid(),
  workspace_id                  uuid        not null references public.workspaces(id) on delete cascade,
  confidence_threshold          integer     not null default 70,     -- templates scoring >= this are "recommended"
  -- Future-preparation only. Stays false. No server function writes this column;
  -- the deployment layer asserts execution is disabled regardless of its value.
  autonomous_deployment_enabled boolean     not null default false,
  updated_by                    uuid,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  unique (workspace_id)
);
create index if not exists sm_intel_settings_ws_idx on public.systemmind_intelligence_settings (workspace_id);

-- ── RLS ────────────────────────────────────────────────────────────────────────
alter table public.systemmind_template_confidence   enable row level security;
alter table public.systemmind_deployment_plans       enable row level security;
alter table public.systemmind_intelligence_settings  enable row level security;

-- Policies are intentionally SELECT-only for authenticated members. All writes
-- flow through the service-role client inside the admin-gated server functions,
-- so members can never forge confidence scores, plans, or (critically) the
-- autonomous_deployment_enabled flag / execution_status via direct PostgREST.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'systemmind_template_confidence' and policyname = 'sm_conf_sel') then
    create policy "sm_conf_sel" on public.systemmind_template_confidence for select
      using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'systemmind_deployment_plans' and policyname = 'sm_plan_sel') then
    create policy "sm_plan_sel" on public.systemmind_deployment_plans for select
      using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'systemmind_intelligence_settings' and policyname = 'sm_intel_settings_sel') then
    create policy "sm_intel_settings_sel" on public.systemmind_intelligence_settings for select
      using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
  end if;
end $$;

-- ── Grants ──────────────────────────────────────────────────────────────────────
-- Read-only for authenticated members; writes are service-role only.
grant select on public.systemmind_template_confidence   to authenticated;
grant select on public.systemmind_deployment_plans       to authenticated;
grant select on public.systemmind_intelligence_settings  to authenticated;
grant all on public.systemmind_template_confidence   to service_role;
grant all on public.systemmind_deployment_plans       to service_role;
grant all on public.systemmind_intelligence_settings  to service_role;
