-- ── SystemMind CTO Dashboard — 5 tables ────────────────────────────────────────
-- Apply MANUALLY in the Supabase SQL Editor (Dashboard → SQL Editor → Run).
-- Idempotent: all statements use IF NOT EXISTS.

-- 1. AI-generated recommendations ──────────────────────────────────────────────
create table if not exists public.systemmind_recommendations (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references public.workspaces(id) on delete cascade,
  priority     text        not null default 'medium',  -- critical|high|medium|low
  category     text        not null default 'general',
  title        text        not null,
  body         text,
  source       text        default 'ai',               -- ai|audit|system
  dismissed_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists sm_rec_ws_idx
  on public.systemmind_recommendations (workspace_id, created_at desc);

-- 2. Platform health audits ─────────────────────────────────────────────────────
create table if not exists public.systemmind_audits (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references public.workspaces(id) on delete cascade,
  triggered_by text        not null default 'manual',  -- manual|auto
  status       text        not null default 'running', -- running|complete|failed
  score        integer,
  summary      jsonb       not null default '{}'::jsonb,
  findings     jsonb       not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists sm_aud_ws_idx
  on public.systemmind_audits (workspace_id, created_at desc);

-- 3. Fix plans (step-by-step repair guides) ────────────────────────────────────
create table if not exists public.systemmind_fix_plans (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references public.workspaces(id) on delete cascade,
  source_type  text,   -- issue|recommendation|audit|manual
  source_id    text,
  title        text        not null,
  detail       text,
  steps        jsonb       not null default '[]'::jsonb,  -- [{idx,title,detail,done}]
  status       text        not null default 'open',       -- open|in_progress|done
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists sm_fp_ws_idx
  on public.systemmind_fix_plans (workspace_id, created_at desc);

-- 4. CTO task board ─────────────────────────────────────────────────────────────
create table if not exists public.systemmind_tasks (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references public.workspaces(id) on delete cascade,
  title        text        not null,
  description  text,
  status       text        not null default 'open',    -- open|in_progress|done
  priority     text        not null default 'medium',  -- critical|high|medium|low
  due_at       timestamptz,
  tags         text[]      not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists sm_task_ws_idx
  on public.systemmind_tasks (workspace_id, status);

-- 5. Technical reports ──────────────────────────────────────────────────────────
create table if not exists public.systemmind_reports (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references public.workspaces(id) on delete cascade,
  title        text        not null,
  body         text        not null,
  model        text        not null default 'gpt-4o-mini',
  created_at   timestamptz not null default now()
);
create index if not exists sm_rep_ws_idx
  on public.systemmind_reports (workspace_id, created_at desc);

-- 6. CTO preferences on workspace_settings ─────────────────────────────────────
alter table public.workspace_settings
  add column if not exists systemmind_cto_settings jsonb default '{}'::jsonb;

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.systemmind_recommendations enable row level security;
alter table public.systemmind_audits          enable row level security;
alter table public.systemmind_fix_plans       enable row level security;
alter table public.systemmind_tasks           enable row level security;
alter table public.systemmind_reports         enable row level security;

-- systemmind_recommendations
create policy "sm_rec_sel" on public.systemmind_recommendations for select
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "sm_rec_ins" on public.systemmind_recommendations for insert
  with check (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "sm_rec_upd" on public.systemmind_recommendations for update
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "sm_rec_del" on public.systemmind_recommendations for delete
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));

-- systemmind_audits
create policy "sm_aud_sel" on public.systemmind_audits for select
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "sm_aud_ins" on public.systemmind_audits for insert
  with check (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "sm_aud_upd" on public.systemmind_audits for update
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "sm_aud_del" on public.systemmind_audits for delete
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));

-- systemmind_fix_plans
create policy "sm_fp_sel" on public.systemmind_fix_plans for select
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "sm_fp_ins" on public.systemmind_fix_plans for insert
  with check (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "sm_fp_upd" on public.systemmind_fix_plans for update
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "sm_fp_del" on public.systemmind_fix_plans for delete
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));

-- systemmind_tasks
create policy "sm_task_sel" on public.systemmind_tasks for select
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "sm_task_ins" on public.systemmind_tasks for insert
  with check (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "sm_task_upd" on public.systemmind_tasks for update
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "sm_task_del" on public.systemmind_tasks for delete
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));

-- systemmind_reports
create policy "sm_rep_sel" on public.systemmind_reports for select
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "sm_rep_ins" on public.systemmind_reports for insert
  with check (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "sm_rep_del" on public.systemmind_reports for delete
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));

-- ── Grants ────────────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.systemmind_recommendations to authenticated;
grant select, insert, update, delete on public.systemmind_audits          to authenticated;
grant select, insert, update, delete on public.systemmind_fix_plans       to authenticated;
grant select, insert, update, delete on public.systemmind_tasks           to authenticated;
grant select, insert, delete         on public.systemmind_reports         to authenticated;

grant all on public.systemmind_recommendations to service_role;
grant all on public.systemmind_audits          to service_role;
grant all on public.systemmind_fix_plans       to service_role;
grant all on public.systemmind_tasks           to service_role;
grant all on public.systemmind_reports         to service_role;
