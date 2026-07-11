-- ─────────────────────────────────────────────────────────────────────────────
-- SystemMind Automation Layer — foundations (Task: approval-first draft engine)
--
--   systemmind_runs              — one row per SystemMind generation run
--   systemmind_generated_actions — draft objects produced by a run (approval-first
--                                  lifecycle: draft → pending_approval → approved →
--                                  active → paused / rejected / failed)
--   systemmind_audit_logs        — append-only audit of every generation and
--                                  lifecycle transition (SELECT-only for members;
--                                  writes happen server-side via service_role)
--
-- Additive + idempotent: safe to re-run. Apply manually to the shared Supabase DB
-- (Management API via scripts/apply-systemmind-automation-migration.mjs, or the
-- SQL Editor).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. systemmind_runs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.systemmind_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL,
  created_by_user_id  UUID,
  instructed_by       TEXT NOT NULL DEFAULT 'user'
                      CHECK (instructed_by IN ('user','hivemind','admin')),
  run_type            TEXT NOT NULL DEFAULT 'workflow_generation',
  input_description   TEXT,
  status              TEXT NOT NULL DEFAULT 'running'
                      CHECK (status IN ('queued','running','completed','failed')),
  model_provider      TEXT,
  model_id            TEXT,
  used_fallback       BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_from       TEXT,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cost_usd            NUMERIC(10,6) NOT NULL DEFAULT 0,
  error               TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sm_runs_ws_created
  ON public.systemmind_runs (workspace_id, created_at DESC);

ALTER TABLE public.systemmind_runs ENABLE ROW LEVEL SECURITY;

-- Members can READ their workspace's runs; ALL writes go through the server
-- (service_role bypasses RLS). No INSERT/UPDATE/DELETE for authenticated —
-- direct PostgREST writes would bypass the approval-first lifecycle.
DROP POLICY IF EXISTS "sm_runs_members" ON public.systemmind_runs;
CREATE POLICY "sm_runs_members" ON public.systemmind_runs
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.systemmind_runs FROM authenticated;
GRANT SELECT ON public.systemmind_runs TO authenticated;

-- ── 2. systemmind_generated_actions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.systemmind_generated_actions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL,
  run_id                UUID REFERENCES public.systemmind_runs(id) ON DELETE SET NULL,
  created_by_user_id    UUID,
  source                TEXT NOT NULL DEFAULT 'systemmind',
  instructed_by         TEXT NOT NULL DEFAULT 'user'
                        CHECK (instructed_by IN ('user','hivemind','admin')),
  action_kind           TEXT NOT NULL DEFAULT 'workspace_workflow',
  title                 TEXT NOT NULL,
  purpose               TEXT,
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  required_credentials  JSONB NOT NULL DEFAULT '[]'::jsonb,
  test_plan             JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_level            TEXT NOT NULL DEFAULT 'low'
                        CHECK (risk_level IN ('low','medium','high')),
  risk_reasons          JSONB NOT NULL DEFAULT '[]'::jsonb,
  approval_required     BOOLEAN NOT NULL DEFAULT TRUE,
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','pending_approval','approved','active','paused','rejected','failed')),
  version               INTEGER NOT NULL DEFAULT 1,
  previous_version_id   UUID,
  hivemind_action_id    UUID,
  activated_target_type TEXT,
  activated_target_id   UUID,
  model_provider        TEXT,
  model_id              TEXT,
  is_deleted            BOOLEAN NOT NULL DEFAULT FALSE,
  error_message         TEXT,
  approved_by           TEXT,
  approved_at           TIMESTAMPTZ,
  activated_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sm_gen_actions_ws_created
  ON public.systemmind_generated_actions (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sm_gen_actions_ws_status
  ON public.systemmind_generated_actions (workspace_id, status);

ALTER TABLE public.systemmind_generated_actions ENABLE ROW LEVEL SECURITY;

-- Members can READ their workspace's drafts; ALL writes go through the server
-- (service_role bypasses RLS). Direct PostgREST writes could flip status to
-- 'active' or tamper the payload between review and approval (TOCTOU).
DROP POLICY IF EXISTS "sm_gen_actions_members" ON public.systemmind_generated_actions;
CREATE POLICY "sm_gen_actions_members" ON public.systemmind_generated_actions
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.systemmind_generated_actions FROM authenticated;
GRANT SELECT ON public.systemmind_generated_actions TO authenticated;

-- ── 3. systemmind_audit_logs (append-only) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.systemmind_audit_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL,
  user_id               UUID,
  source_agent          TEXT NOT NULL DEFAULT 'systemmind',
  instructed_by         TEXT NOT NULL DEFAULT 'user',
  action_type           TEXT NOT NULL,
  target_type           TEXT,
  target_id             TEXT,
  before_state          JSONB,
  proposed_after_state  JSONB,
  final_after_state     JSONB,
  approval_status       TEXT,
  approved_by           TEXT,
  approved_at           TIMESTAMPTZ,
  executed_at           TIMESTAMPTZ,
  error                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sm_audit_ws_created
  ON public.systemmind_audit_logs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sm_audit_ws_target
  ON public.systemmind_audit_logs (workspace_id, target_type, target_id);

ALTER TABLE public.systemmind_audit_logs ENABLE ROW LEVEL SECURITY;

-- Members can READ their workspace's audit trail; all writes go through the
-- server (service_role bypasses RLS). No INSERT/UPDATE/DELETE for authenticated.
DROP POLICY IF EXISTS "sm_audit_members_read" ON public.systemmind_audit_logs;
CREATE POLICY "sm_audit_members_read" ON public.systemmind_audit_logs
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

GRANT SELECT ON public.systemmind_audit_logs TO authenticated;

-- ── 4. updated_at triggers ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sm_automation_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sm_runs_updated_at ON public.systemmind_runs;
CREATE TRIGGER sm_runs_updated_at
  BEFORE UPDATE ON public.systemmind_runs
  FOR EACH ROW EXECUTE FUNCTION public.sm_automation_set_updated_at();

DROP TRIGGER IF EXISTS sm_gen_actions_updated_at ON public.systemmind_generated_actions;
CREATE TRIGGER sm_gen_actions_updated_at
  BEFORE UPDATE ON public.systemmind_generated_actions
  FOR EACH ROW EXECUTE FUNCTION public.sm_automation_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- End of SystemMind Automation Layer migration
-- ─────────────────────────────────────────────────────────────────────────────
