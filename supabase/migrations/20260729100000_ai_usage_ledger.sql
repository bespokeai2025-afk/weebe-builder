-- ── Platform-wide AI usage & cost ledger ─────────────────────────────────────
-- One row per AI request (success / failed / fallback / diagnostic) across all
-- Minds and background jobs. Server-write-only: RLS enabled with NO policies
-- for authenticated, and default grants revoked — all reads/writes go through
-- service_role in admin-gated server functions.
-- Additive + idempotent; safe to re-run.

CREATE TABLE IF NOT EXISTS public.ai_usage_ledger (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  workspace_id        uuid        NULL,
  department          text        NOT NULL,
  feature             text        NOT NULL,
  provider            text        NOT NULL,
  requested_model     text        NOT NULL,
  returned_model      text        NULL,
  endpoint            text        NULL,
  request_id          text        NULL,
  input_tokens        integer     NOT NULL DEFAULT 0,
  cached_input_tokens integer     NOT NULL DEFAULT 0,
  output_tokens       integer     NOT NULL DEFAULT 0,
  reasoning_tokens    integer     NOT NULL DEFAULT 0,
  video_seconds       numeric     NOT NULL DEFAULT 0,
  latency_ms          integer     NULL,
  status              text        NOT NULL CHECK (status IN ('success','failed','fallback','diagnostic')),
  fallback_used       boolean     NOT NULL DEFAULT false,
  fallback_from       text        NULL,
  error_message       text        NULL,
  estimated_cost_usd  numeric     NOT NULL DEFAULT 0,
  routing             jsonb       NULL
);

CREATE INDEX IF NOT EXISTS ai_usage_ledger_ws_created_idx
  ON public.ai_usage_ledger (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_ledger_created_idx
  ON public.ai_usage_ledger (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_ledger_dept_created_idx
  ON public.ai_usage_ledger (department, created_at DESC);

-- Server-write-only: enable RLS with zero policies for authenticated (deny-all)
-- and revoke the default table grants that Supabase gives authenticated/anon.
ALTER TABLE public.ai_usage_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_ledger FROM authenticated;
REVOKE ALL ON public.ai_usage_ledger FROM anon;
