-- ─────────────────────────────────────────────────────────────────────────────
-- SystemMind Build Workspace protection — rollback snapshots.
--
--   systemmind_build_snapshots — captures the FULL prior state of every target
--   the Build Workspace apply path is about to modify (workspace_workflows row,
--   custom_agent_configs row, and a whitelisted non-secret view of the agent's
--   deployment settings), so any apply to an existing target can be rolled
--   back with one click.
--
-- RLS posture (established pattern): SELECT-only for workspace members; ALL
-- writes go through the service role (REVOKE writes from authenticated —
-- Supabase default grants give ALL).
--
-- Additive + idempotent: safe to re-run. Apply via
-- scripts/apply-systemmind-build-snapshots-migration.mjs (Management API) or
-- the Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.systemmind_build_snapshots (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID NOT NULL,
  created_by_user_id   UUID,
  -- Build provenance
  session_id           UUID,
  version_id           UUID,
  version_number       INTEGER,
  -- What this snapshot protects
  target_workflow_id   UUID,
  target_agent_id      UUID,
  reason               TEXT NOT NULL DEFAULT 'pre_apply'
                       CHECK (reason IN ('pre_apply','pre_go_live','manual')),
  -- Prior state (NULL when the target part didn't exist before the apply)
  workflow_state       JSONB,
  agent_config_state   JSONB,
  agent_settings_state JSONB,
  -- Rollback bookkeeping
  restored_at          TIMESTAMPTZ,
  restored_by_user_id  UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sm_build_snapshots_ws_created
  ON public.systemmind_build_snapshots (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sm_build_snapshots_session
  ON public.systemmind_build_snapshots (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sm_build_snapshots_workflow
  ON public.systemmind_build_snapshots (target_workflow_id) WHERE target_workflow_id IS NOT NULL;

ALTER TABLE public.systemmind_build_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sm_build_snapshots_members" ON public.systemmind_build_snapshots;
CREATE POLICY "sm_build_snapshots_members" ON public.systemmind_build_snapshots
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.systemmind_build_snapshots FROM authenticated;
GRANT SELECT ON public.systemmind_build_snapshots TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- End of SystemMind Build snapshots migration
-- ─────────────────────────────────────────────────────────────────────────────
