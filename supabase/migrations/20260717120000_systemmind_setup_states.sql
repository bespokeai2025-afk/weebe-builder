-- SystemMind Setup Console — per-build-session setup state.
-- One row per build session. Holds the agent scan, variable mappings, CRM
-- (non-secret) config, trigger rules and test/approval state. Credentials are
-- NEVER stored here — they live in provider_settings via the existing
-- provider credential flow.
SET lock_timeout = '8s';

CREATE TABLE IF NOT EXISTS public.systemmind_setup_states (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  session_id    uuid NOT NULL UNIQUE,
  agent_id      uuid,
  scan          jsonb NOT NULL DEFAULT '{}'::jsonb,
  mappings      jsonb NOT NULL DEFAULT '[]'::jsonb,
  crm           jsonb NOT NULL DEFAULT '{}'::jsonb,
  triggers      jsonb NOT NULL DEFAULT '[]'::jsonb,
  test          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smss_workspace
  ON public.systemmind_setup_states (workspace_id, updated_at DESC);

ALTER TABLE public.systemmind_setup_states ENABLE ROW LEVEL SECURITY;

-- Members of the workspace may read; all writes are server-only (service role).
DROP POLICY IF EXISTS smss_members_select ON public.systemmind_setup_states;
CREATE POLICY smss_members_select ON public.systemmind_setup_states
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM public.workspace_members wm
      WHERE wm.user_id = auth.uid()
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.systemmind_setup_states FROM anon, authenticated;
