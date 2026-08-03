-- WBAH post-call job queue — async execution + retries for campaign scale (200+ calls).
CREATE TABLE IF NOT EXISTS public.wbah_post_call_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL,
  retell_call_id   TEXT,
  lead_id          TEXT,
  event            TEXT NOT NULL,
  agent_id         TEXT,
  payload          JSONB NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempt_count    INT NOT NULL DEFAULT 0,
  max_attempts     INT NOT NULL DEFAULT 5,
  next_retry_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error       TEXT,
  branches         JSONB NOT NULL DEFAULT '[]',
  errors           JSONB NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wbah_post_call_jobs_pending
  ON public.wbah_post_call_jobs (next_retry_at ASC)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_wbah_post_call_jobs_call
  ON public.wbah_post_call_jobs (retell_call_id, event);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wbah_post_call_jobs_dedupe
  ON public.wbah_post_call_jobs (retell_call_id, event, workspace_id)
  WHERE retell_call_id IS NOT NULL AND status IN ('pending', 'processing');

ALTER TABLE public.wbah_post_call_jobs ENABLE ROW LEVEL SECURITY;
