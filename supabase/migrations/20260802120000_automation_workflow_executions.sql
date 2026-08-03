-- Automation engine execution persistence (Phase 3).
-- Node-level run history for SystemMind automation workflows + WBAH post-call jobs.

CREATE TABLE IF NOT EXISTS public.automation_workflow_executions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL,
  workflow_id       UUID,
  wbah_job_id       UUID REFERENCES public.wbah_post_call_jobs(id) ON DELETE SET NULL,
  workflow_name     TEXT NOT NULL DEFAULT '',
  source            TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual', 'dry_run', 'webhook', 'queue')),
  status            TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('pending', 'running', 'waiting', 'completed', 'failed', 'cancelled')),
  trigger_masked    JSONB NOT NULL DEFAULT '{}',
  summary           JSONB NOT NULL DEFAULT '{}',
  last_error        TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_executions_ws
  ON public.automation_workflow_executions (workspace_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_executions_job
  ON public.automation_workflow_executions (wbah_job_id)
  WHERE wbah_job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.automation_execution_steps (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id      UUID NOT NULL REFERENCES public.automation_workflow_executions(id) ON DELETE CASCADE,
  workspace_id      UUID NOT NULL,
  sequence_num      INT NOT NULL DEFAULT 0,
  node_id           TEXT NOT NULL,
  node_type         TEXT NOT NULL DEFAULT '',
  node_name         TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'success', 'error', 'skipped', 'waiting')),
  branch            TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  output_masked     JSONB NOT NULL DEFAULT '{}',
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_steps_execution
  ON public.automation_execution_steps (execution_id, sequence_num ASC);

ALTER TABLE public.wbah_post_call_jobs
  ADD COLUMN IF NOT EXISTS automation_execution_id UUID
  REFERENCES public.automation_workflow_executions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wbah_jobs_automation_execution
  ON public.wbah_post_call_jobs (automation_execution_id)
  WHERE automation_execution_id IS NOT NULL;

ALTER TABLE public.automation_workflow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_execution_steps ENABLE ROW LEVEL SECURITY;
