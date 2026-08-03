-- Automation engine Phase 5: snapshots, step I/O, queue, resume tokens.

ALTER TABLE public.automation_workflow_executions
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (mode IN ('manual', 'test', 'production'));

ALTER TABLE public.automation_workflow_executions
  ADD COLUMN IF NOT EXISTS snapshot JSONB;

CREATE INDEX IF NOT EXISTS idx_automation_executions_waiting
  ON public.automation_workflow_executions (workspace_id, status)
  WHERE status = 'waiting';

ALTER TABLE public.automation_execution_steps
  ADD COLUMN IF NOT EXISTS input_masked JSONB NOT NULL DEFAULT '{}';

ALTER TABLE public.automation_execution_steps
  ADD COLUMN IF NOT EXISTS logs JSONB NOT NULL DEFAULT '[]';

ALTER TABLE public.automation_execution_steps
  ADD COLUMN IF NOT EXISTS duration_ms INT;

CREATE TABLE IF NOT EXISTS public.automation_execution_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL,
  execution_id      UUID REFERENCES public.automation_workflow_executions(id) ON DELETE CASCADE,
  workflow_id       UUID,
  workflow_document JSONB NOT NULL,
  trigger_masked    JSONB NOT NULL DEFAULT '{}',
  mode              TEXT NOT NULL DEFAULT 'production'
                    CHECK (mode IN ('manual', 'test', 'production')),
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  priority          INT NOT NULL DEFAULT 0,
  attempt_count     INT NOT NULL DEFAULT 0,
  max_attempts      INT NOT NULL DEFAULT 3,
  next_run_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_queue_pending
  ON public.automation_execution_queue (status, next_run_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_automation_queue_ws
  ON public.automation_execution_queue (workspace_id, created_at DESC);

ALTER TABLE public.automation_execution_queue ENABLE ROW LEVEL SECURITY;
