-- SystemMind Test Call Validation Loop
--   systemmind_test_calls — per-session/version history of test-call analyses.
--   Every analysis (or manual pass override) is one row; the deployment
--   checklist derives the mandatory test gate for SystemMind builds from the
--   latest row of the session's current version.
--
-- All writes go through the service role (REVOKE writes from authenticated);
-- workspace members can read their own workspace's rows.

CREATE TABLE IF NOT EXISTS public.systemmind_test_calls (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL,
  session_id          uuid NOT NULL,
  version_id          uuid,
  agent_id            uuid,
  workflow_id         uuid,
  call_id             uuid,
  retell_call_id      text,
  test_scenario       text NOT NULL DEFAULT 'custom',
  expected_result     jsonb NOT NULL DEFAULT '{}'::jsonb,
  actual_result       jsonb NOT NULL DEFAULT '{}'::jsonb,
  checks              jsonb NOT NULL DEFAULT '[]'::jsonb,
  passed              boolean NOT NULL DEFAULT false,
  failed_checks       jsonb NOT NULL DEFAULT '[]'::jsonb,
  diagnosis           text,
  suggested_fix       text,
  is_manual_override  boolean NOT NULL DEFAULT false,
  tested_by_user_id   uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smtc_ws_session
  ON public.systemmind_test_calls (workspace_id, session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_smtc_version
  ON public.systemmind_test_calls (version_id) WHERE version_id IS NOT NULL;

ALTER TABLE public.systemmind_test_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sm_test_calls_members" ON public.systemmind_test_calls;
CREATE POLICY "sm_test_calls_members" ON public.systemmind_test_calls
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.systemmind_test_calls FROM authenticated;
