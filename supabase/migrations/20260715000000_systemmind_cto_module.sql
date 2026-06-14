-- ── SystemMind CTO Dashboard — 5 new tables ───────────────────────────────────
-- Apply MANUALLY in the Supabase SQL Editor (Dashboard → SQL Editor → Run).
-- Idempotent: all statements use IF NOT EXISTS / OR REPLACE.

-- 1. AI-generated recommendations ─────────────────────────────────────────────
create table if not exists systemmind_recommendations (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id text        not null,
  category     text        not null default 'general',
  title        text        not null,
  detail       text,
  priority     text        not null default 'medium',  -- critical|high|medium|low
  status       text        not null default 'open',    -- open|dismissed|done
  source       text        default 'ai',               -- ai|audit|system
  dismissed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists systemmind_recommendations_ws_idx
  on systemmind_recommendations (workspace_id, status);

-- 2. Platform health audits ────────────────────────────────────────────────────
create table if not exists systemmind_audits (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id text        not null,
  status       text        not null default 'running',  -- running|complete|failed
  score        integer,
  summary      text,
  findings     jsonb       not null default '[]'::jsonb,
  run_at       timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists systemmind_audits_ws_idx
  on systemmind_audits (workspace_id, run_at desc);

-- 3. Fix plans (step-by-step repair guides) ────────────────────────────────────
create table if not exists systemmind_fix_plans (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id text        not null,
  source_type  text,   -- issue|recommendation|audit|manual
  source_id    text,
  title        text        not null,
  detail       text,
  steps        jsonb       not null default '[]'::jsonb,  -- [{idx,title,detail,done}]
  status       text        not null default 'open',       -- open|in_progress|done
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists systemmind_fix_plans_ws_idx
  on systemmind_fix_plans (workspace_id, created_at desc);

-- 4. CTO task board ────────────────────────────────────────────────────────────
create table if not exists systemmind_tasks (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id text        not null,
  title        text        not null,
  description  text,
  status       text        not null default 'open',    -- open|in_progress|done
  priority     text        not null default 'medium',  -- critical|high|medium|low
  due_date     date,
  tags         text[]      not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists systemmind_tasks_ws_idx
  on systemmind_tasks (workspace_id, status);

-- 5. Technical reports ─────────────────────────────────────────────────────────
create table if not exists systemmind_reports (
  id            uuid        primary key default gen_random_uuid(),
  workspace_id  text        not null,
  title         text        not null,
  content       text        not null,
  data_snapshot jsonb,
  generated_at  timestamptz not null default now()
);
create index if not exists systemmind_reports_ws_idx
  on systemmind_reports (workspace_id, generated_at desc);

-- 6. CTO preferences on workspace_settings ─────────────────────────────────────
alter table workspace_settings
  add column if not exists systemmind_cto_settings jsonb default '{}'::jsonb;
