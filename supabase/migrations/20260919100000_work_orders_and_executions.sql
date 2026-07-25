-- Workstream 1: unified work-order / execution backbone.
-- Adds: work_orders (parent objective), mind_task_executions (execution records),
-- linkage columns on hivemind_tasks and hivemind_actions.
-- Idempotent / additive only. Standard workspace-members RLS pattern.

-- ── work_orders ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.work_orders (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              uuid NOT NULL,
  title                     text NOT NULL,
  objective                 text,
  commercial_objective      text,
  status                    text NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open','in_progress','awaiting_approval','blocked','partially_completed','completed','cancelled','failed')),
  source                    text NOT NULL DEFAULT 'manual',
  source_recommendation_id  uuid,
  source_conversation_id    uuid,
  created_by_user_id        uuid,
  assigned_minds            text[] NOT NULL DEFAULT '{}',
  result_summary            text,
  evidence                  jsonb,
  metadata                  jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  completed_at              timestamptz
);
CREATE INDEX IF NOT EXISTS idx_work_orders_ws_status
  ON public.work_orders (workspace_id, status, updated_at DESC);

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'work_orders_workspace_members'
      AND polrelid = 'public.work_orders'::regclass
  ) THEN
    CREATE POLICY work_orders_workspace_members ON public.work_orders
      FOR ALL TO authenticated
      USING (workspace_id IN (
        SELECT workspace_members.workspace_id FROM workspace_members
        WHERE workspace_members.user_id = auth.uid()))
      WITH CHECK (workspace_id IN (
        SELECT workspace_members.workspace_id FROM workspace_members
        WHERE workspace_members.user_id = auth.uid()));
  END IF;
END $$;

-- ── mind_task_executions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mind_task_executions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL,
  task_id            uuid NOT NULL,
  work_order_id      uuid,
  assigned_mind      text NOT NULL,
  action_kind        text NOT NULL,
  status             text NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued','executing','awaiting_action_approval','awaiting_external_result','verifying','completed','partially_completed','blocked','failed','cancelled')),
  trigger_source     text NOT NULL DEFAULT 'user_approval',
  triggered_by_user  uuid,
  input_spec         jsonb,
  steps              jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_step       int  NOT NULL DEFAULT 0,
  artifacts          jsonb NOT NULL DEFAULT '[]'::jsonb,
  linked_action_id   uuid,
  result             jsonb,
  evidence           jsonb,
  verification       jsonb,
  error_message      text,
  blocked_reason     text,
  cost_summary       jsonb,
  started_at         timestamptz,
  finished_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mind_task_exec_ws_task
  ON public.mind_task_executions (workspace_id, task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mind_task_exec_ws_status
  ON public.mind_task_executions (workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mind_task_exec_linked_action
  ON public.mind_task_executions (workspace_id, linked_action_id)
  WHERE linked_action_id IS NOT NULL;

ALTER TABLE public.mind_task_executions ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'mind_task_executions_workspace_members'
      AND polrelid = 'public.mind_task_executions'::regclass
  ) THEN
    CREATE POLICY mind_task_executions_workspace_members ON public.mind_task_executions
      FOR ALL TO authenticated
      USING (workspace_id IN (
        SELECT workspace_members.workspace_id FROM workspace_members
        WHERE workspace_members.user_id = auth.uid()))
      WITH CHECK (workspace_id IN (
        SELECT workspace_members.workspace_id FROM workspace_members
        WHERE workspace_members.user_id = auth.uid()));
  END IF;
END $$;

-- ── hivemind_tasks: work-order / execution linkage ────────────────────────────
ALTER TABLE public.hivemind_tasks ADD COLUMN IF NOT EXISTS work_order_id        uuid;
ALTER TABLE public.hivemind_tasks ADD COLUMN IF NOT EXISTS task_category        text NOT NULL DEFAULT 'legacy';
ALTER TABLE public.hivemind_tasks ADD COLUMN IF NOT EXISTS assigned_mind        text;
ALTER TABLE public.hivemind_tasks ADD COLUMN IF NOT EXISTS action_kind          text;
ALTER TABLE public.hivemind_tasks ADD COLUMN IF NOT EXISTS execution_status     text;
ALTER TABLE public.hivemind_tasks ADD COLUMN IF NOT EXISTS input_spec           jsonb;
ALTER TABLE public.hivemind_tasks ADD COLUMN IF NOT EXISTS active_execution_id  uuid;
ALTER TABLE public.hivemind_tasks ADD COLUMN IF NOT EXISTS result_summary       text;
ALTER TABLE public.hivemind_tasks ADD COLUMN IF NOT EXISTS completion_evidence  jsonb;
ALTER TABLE public.hivemind_tasks ADD COLUMN IF NOT EXISTS completed_at         timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hivemind_tasks_task_category_check'
  ) THEN
    ALTER TABLE public.hivemind_tasks
      ADD CONSTRAINT hivemind_tasks_task_category_check
      CHECK (task_category IN ('legacy','executable','informational'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hivemind_tasks_execution_status_check'
  ) THEN
    ALTER TABLE public.hivemind_tasks
      ADD CONSTRAINT hivemind_tasks_execution_status_check
      CHECK (execution_status IS NULL OR execution_status IN
        ('draft','awaiting_approval','queued','executing','awaiting_action_approval','awaiting_external_result','verifying','completed','partially_completed','blocked','failed','cancelled'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_hivemind_tasks_ws_work_order
  ON public.hivemind_tasks (workspace_id, work_order_id)
  WHERE work_order_id IS NOT NULL;

-- ── hivemind_actions: task / execution linkage ────────────────────────────────
ALTER TABLE public.hivemind_actions ADD COLUMN IF NOT EXISTS work_order_id uuid;
ALTER TABLE public.hivemind_actions ADD COLUMN IF NOT EXISTS task_id       uuid;
ALTER TABLE public.hivemind_actions ADD COLUMN IF NOT EXISTS execution_id  uuid;
CREATE INDEX IF NOT EXISTS idx_hivemind_actions_ws_execution
  ON public.hivemind_actions (workspace_id, execution_id)
  WHERE execution_id IS NOT NULL;
