-- ─────────────────────────────────────────────────────────────────────────────
-- SystemMind Guided Requirements Assistant — interview state.
--
--   systemmind_requirements_interviews — one row per guided requirements
--   interview, keyed to a Build Workspace session. Holds the deterministic
--   analyzer output (detected), the gap-driven question catalog (questions),
--   and the user's answers (answers). Generation output is NOT stored here:
--   every generation/re-prompt produces a normal immutable
--   systemmind_build_versions row via the existing Build Workspace pipeline.
--
-- RLS posture (established pattern): SELECT-only for workspace members; ALL
-- writes go through the service role (REVOKE writes from authenticated —
-- Supabase default grants give ALL).
--
-- Additive + idempotent: safe to re-run. Apply via
-- scripts/apply-systemmind-requirements-migration.mjs (Management API) or the
-- Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.systemmind_requirements_interviews (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL,
  session_id          UUID NOT NULL,
  agent_id            UUID NOT NULL,
  created_by_user_id  UUID,
  -- Deterministic analyzer output: detected setup summary (purpose, channel,
  -- variables, existing extraction/booking/sentiment logic, provider, deploy
  -- status). Recomputed on demand; this copy is what the questions were built
  -- against.
  detected            JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Gap-driven question catalog shown to the user (with recommended defaults).
  questions           JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- The user's answers, keyed by question key. Only whitelisted keys accepted.
  answers             JSONB NOT NULL DEFAULT '{}'::jsonb,
  status              TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN (
                        'in_progress','generated','applied','abandoned')),
  last_generated_version_id UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sm_req_interviews_ws
  ON public.systemmind_requirements_interviews (workspace_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sm_req_interviews_session
  ON public.systemmind_requirements_interviews (session_id);
CREATE INDEX IF NOT EXISTS idx_sm_req_interviews_agent
  ON public.systemmind_requirements_interviews (workspace_id, agent_id);

ALTER TABLE public.systemmind_requirements_interviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sm_req_interviews_members" ON public.systemmind_requirements_interviews;
CREATE POLICY "sm_req_interviews_members" ON public.systemmind_requirements_interviews
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.systemmind_requirements_interviews FROM authenticated;
GRANT SELECT ON public.systemmind_requirements_interviews TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- End of SystemMind requirements interviews migration
-- ─────────────────────────────────────────────────────────────────────────────
