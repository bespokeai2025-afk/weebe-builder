-- ─────────────────────────────────────────────────────────────────────────────
-- SystemMind Deployment Orchestrator — deployment records + approval rows.
--
--   systemmind_deployments — one row per orchestrated agent deployment. Holds
--   lineage (agent, retell agent, build session/version, workflow), the human
--   decisions that can't be recomputed (checklist_overrides JSONB: skips,
--   test-call results, selected number path), and a report snapshot. The
--   checklist itself is ALWAYS recomputed live from real data — this row never
--   becomes the source of truth for detection.
--
--   systemmind_deployment_approvals — one row per approval-gated action
--   (purchase_number / assign_number / import_sip / reassign_number / go_live).
--   Single-use: executors consume atomically via
--   UPDATE ... WHERE status = 'approved' AND consumed_at IS NULL RETURNING.
--   payload JSONB carries the cost estimate / number / trunk details shown to
--   the approver. Never contains credential values.
--
-- RLS posture (established pattern): SELECT-only for workspace members; ALL
-- writes go through the service role (REVOKE writes from authenticated —
-- Supabase default grants give ALL).
--
-- Additive + idempotent: safe to re-run. Apply via
-- scripts/apply-systemmind-deployments-migration.mjs (Management API) or the
-- Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.systemmind_deployments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL,
  created_by_user_id  UUID,
  -- What is being deployed
  agent_id            UUID NOT NULL,
  retell_agent_id     TEXT,
  agent_type          TEXT,
  deployment_type     TEXT NOT NULL DEFAULT 'custom_workflow' CHECK (deployment_type IN (
                        'receptionist','lead_generation','qualification',
                        'whatsapp','sms','custom_workflow')),
  -- Telephony outcome (filled as steps complete)
  phone_number        TEXT,
  phone_number_id     TEXT,
  sip_trunk_ref       TEXT,
  -- Lineage
  workflow_id         UUID,
  build_session_id    UUID,
  build_version_id    UUID,
  -- Lifecycle
  status              TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN (
                        'in_progress','blocked','ready','live','abandoned')),
  go_live_at          TIMESTAMPTZ,
  -- Human decisions that detection can't recompute (skips, test-call result,
  -- chosen telephony path). NEVER detection results.
  checklist_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Latest checklist snapshot for the Workflows page / audit (display only)
  report              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by          TEXT NOT NULL DEFAULT 'systemmind',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sm_deployments_ws_created
  ON public.systemmind_deployments (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sm_deployments_agent
  ON public.systemmind_deployments (workspace_id, agent_id);

CREATE TABLE IF NOT EXISTS public.systemmind_deployment_approvals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id       UUID NOT NULL REFERENCES public.systemmind_deployments (id) ON DELETE CASCADE,
  workspace_id        UUID NOT NULL,
  action_type         TEXT NOT NULL CHECK (action_type IN (
                        'purchase_number','assign_number','import_sip',
                        'reassign_number','go_live')),
  -- What the approver saw: cost estimate, provider, country, number, agent,
  -- billing warning. Never credential values.
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending','approved','rejected','consumed','failed')),
  requested_by        UUID,
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by         UUID,
  approved_at         TIMESTAMPTZ,
  consumed_at         TIMESTAMPTZ,
  result              JSONB,
  error               TEXT
);

CREATE INDEX IF NOT EXISTS idx_sm_deploy_approvals_deployment
  ON public.systemmind_deployment_approvals (deployment_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_sm_deploy_approvals_ws
  ON public.systemmind_deployment_approvals (workspace_id, status);

ALTER TABLE public.systemmind_deployments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.systemmind_deployment_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sm_deployments_members" ON public.systemmind_deployments;
CREATE POLICY "sm_deployments_members" ON public.systemmind_deployments
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "sm_deploy_approvals_members" ON public.systemmind_deployment_approvals;
CREATE POLICY "sm_deploy_approvals_members" ON public.systemmind_deployment_approvals
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.systemmind_deployments          FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.systemmind_deployment_approvals FROM authenticated;
GRANT SELECT ON public.systemmind_deployments          TO authenticated;
GRANT SELECT ON public.systemmind_deployment_approvals TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- End of SystemMind deployments migration
-- ─────────────────────────────────────────────────────────────────────────────
