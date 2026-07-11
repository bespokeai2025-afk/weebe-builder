-- ─────────────────────────────────────────────────────────────────────────────
-- SystemMind Build Workspace — Replit-style iterative agent/workflow builder.
--
--   systemmind_build_sessions  — one row per build conversation (workspace-scoped)
--   systemmind_build_versions  — immutable numbered versions of the generated setup
--   systemmind_build_messages  — persisted chat transcript per session
--   systemmind_usage_events    — per-run token + elapsed-time usage/billing events
--   cost_engine_systemmind     — admin-configurable SystemMind pricing formula
--                                (cost_engine family, is_current row-versioning)
--
-- Plus additive provenance columns on workspace_workflows (source,
-- source_build_session_id, source_build_version).
--
-- RLS posture (established pattern): build sessions/versions/messages are
-- SELECT-only for workspace members; ALL writes go through the service role.
-- usage events + pricing are NOT member-readable at all — clients see usage
-- only through server functions that filter fields (raw provider cost is
-- admin-only unless the admin config chooses to expose it).
--
-- Additive + idempotent: safe to re-run. Apply manually to the shared Supabase
-- DB (Management API via scripts/apply-systemmind-build-workspace-migration.mjs,
-- or the SQL Editor).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. systemmind_build_sessions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.systemmind_build_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL,
  created_by_user_id  UUID,
  title               TEXT NOT NULL DEFAULT 'Untitled build',
  source_page         TEXT NOT NULL DEFAULT 'agent_builder'
                      CHECK (source_page IN ('agent_builder','whatsapp_builder','follow_up_centre','workflows','systemmind','hivemind')),
  -- Optional linkage: the Builder agent this build is attached to.
  target_agent_id     UUID,
  -- Edit-mode: the live workspace_workflows row this session was opened from
  -- ("Edit with SystemMind"). The live row is NEVER touched until Apply.
  linked_workflow_id  UUID,
  -- Pointer to the latest version (no dual lifecycle — status lives on versions).
  current_version_id  UUID,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sm_build_sessions_ws_updated
  ON public.systemmind_build_sessions (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sm_build_sessions_agent
  ON public.systemmind_build_sessions (target_agent_id) WHERE target_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sm_build_sessions_workflow
  ON public.systemmind_build_sessions (linked_workflow_id) WHERE linked_workflow_id IS NOT NULL;

ALTER TABLE public.systemmind_build_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sm_build_sessions_members" ON public.systemmind_build_sessions;
CREATE POLICY "sm_build_sessions_members" ON public.systemmind_build_sessions
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.systemmind_build_sessions FROM authenticated;
GRANT SELECT ON public.systemmind_build_sessions TO authenticated;

-- ── 2. systemmind_build_versions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.systemmind_build_versions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id               UUID NOT NULL
                           REFERENCES public.systemmind_build_sessions(id) ON DELETE CASCADE,
  workspace_id             UUID NOT NULL,
  created_by_user_id       UUID,
  version_number           INTEGER NOT NULL,
  -- The user instruction that produced this version.
  user_prompt              TEXT,
  -- SystemMind's plain-language explanation of what it built/changed and why.
  assistant_summary        TEXT,
  -- The full generated setup:
  -- { agent_prompt, workflow: { name, purpose, trigger_type, trigger_config,
  --   steps[] }, variables[], extraction_fields[], follow_up_rules[],
  --   channel_setup{}, required_credentials[] (NAMES only, never values),
  --   risks[], test_plan[] }
  generated_config         JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk_level               TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high')),
  risk_reasons             JSONB NOT NULL DEFAULT '[]'::jsonb,
  status                   TEXT NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft','testing','revised','pending_approval','applied','deployed','rejected','archived')),
  notes                    TEXT,
  -- Set when this version was created by restoring an older one (immutable history).
  restored_from_version_id UUID,
  model_provider           TEXT,
  model_id                 TEXT,
  -- Set by Apply: the workspace_workflows row this version was applied into.
  applied_workflow_id      UUID,
  -- Set when the high-risk path routed through the approval hub.
  hub_action_id            UUID,
  applied_at               TIMESTAMPTZ,
  deployed_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_sm_build_versions_session
  ON public.systemmind_build_versions (session_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_sm_build_versions_ws_created
  ON public.systemmind_build_versions (workspace_id, created_at DESC);

ALTER TABLE public.systemmind_build_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sm_build_versions_members" ON public.systemmind_build_versions;
CREATE POLICY "sm_build_versions_members" ON public.systemmind_build_versions
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.systemmind_build_versions FROM authenticated;
GRANT SELECT ON public.systemmind_build_versions TO authenticated;

-- ── 3. systemmind_build_messages ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.systemmind_build_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL
                REFERENCES public.systemmind_build_sessions(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL,
  user_id       UUID,
  role          TEXT NOT NULL CHECK (role IN ('user','systemmind','system')),
  content       TEXT NOT NULL DEFAULT '',
  -- The version this message produced (systemmind messages) or targeted.
  version_id    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sm_build_messages_session
  ON public.systemmind_build_messages (session_id, created_at);

ALTER TABLE public.systemmind_build_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sm_build_messages_members" ON public.systemmind_build_messages;
CREATE POLICY "sm_build_messages_members" ON public.systemmind_build_messages
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.systemmind_build_messages FROM authenticated;
GRANT SELECT ON public.systemmind_build_messages TO authenticated;

-- ── 4. systemmind_usage_events ───────────────────────────────────────────────
-- One row per SystemMind run (generation, simulation, apply, etc.).
-- Raw metrics + per-unit rates FROZEN at write time (pricing_config_id points
-- at the cost_engine_systemmind row used). Monthly allowance/overage is
-- computed at AccountsMind aggregation time, not here.
CREATE TABLE IF NOT EXISTS public.systemmind_usage_events (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                 UUID NOT NULL,
  user_id                      UUID,
  session_id                   UUID,
  version_id                   UUID,
  workflow_id                  UUID,
  task_type                    TEXT NOT NULL DEFAULT 'build_generation',
  source_page                  TEXT NOT NULL DEFAULT 'agent_builder',
  model_provider               TEXT,
  model_id                     TEXT,
  prompt_tokens                INTEGER NOT NULL DEFAULT 0,
  completion_tokens            INTEGER NOT NULL DEFAULT 0,
  total_tokens                 INTEGER NOT NULL DEFAULT 0,
  cached_tokens                INTEGER NOT NULL DEFAULT 0,
  tool_call_count              INTEGER NOT NULL DEFAULT 0,
  started_at                   TIMESTAMPTZ,
  completed_at                 TIMESTAMPTZ,
  elapsed_ms                   INTEGER NOT NULL DEFAULT 0,
  -- Raw provider cost (admin-only visibility).
  estimated_provider_cost_usd  NUMERIC(18,6) NOT NULL DEFAULT 0,
  -- Pricing snapshot frozen at write time.
  pricing_config_id            UUID,
  billable_units               NUMERIC(18,6) NOT NULL DEFAULT 0,
  customer_charge_usd          NUMERIC(18,6) NOT NULL DEFAULT 0,
  billing_status               TEXT NOT NULL DEFAULT 'recorded'
                               CHECK (billing_status IN ('recorded','included','billable','waived')),
  success                      BOOLEAN NOT NULL DEFAULT TRUE,
  error                        TEXT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sm_usage_events_ws_created
  ON public.systemmind_usage_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sm_usage_events_session
  ON public.systemmind_usage_events (session_id) WHERE session_id IS NOT NULL;

-- NOT member-readable: raw provider cost lives here. Server functions expose
-- filtered views to workspace members; AccountsMind (admin) reads everything.
ALTER TABLE public.systemmind_usage_events ENABLE ROW LEVEL SECURITY;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.systemmind_usage_events FROM authenticated;

-- ── 5. cost_engine_systemmind (pricing formula, is_current row-versioning) ───
CREATE TABLE IF NOT EXISTS public.cost_engine_systemmind (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_charge_per_run_usd     NUMERIC(18,6) NOT NULL DEFAULT 0,
  charge_per_minute_usd       NUMERIC(18,6) NOT NULL DEFAULT 0,
  charge_per_1k_tokens_usd    NUMERIC(18,6) NOT NULL DEFAULT 0,
  charge_per_tool_call_usd    NUMERIC(18,6) NOT NULL DEFAULT 0,
  included_runs_per_month     INTEGER NOT NULL DEFAULT 0,
  included_seconds_per_month  INTEGER NOT NULL DEFAULT 0,
  included_tokens_per_month   INTEGER NOT NULL DEFAULT 0,
  overage_multiplier          NUMERIC(18,6) NOT NULL DEFAULT 1,
  -- Whether client-facing UIs may show raw provider cost (default: never).
  expose_provider_cost        BOOLEAN NOT NULL DEFAULT FALSE,
  notes                       TEXT,
  is_current                  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Admin-only config: no member read path at all.
ALTER TABLE public.cost_engine_systemmind ENABLE ROW LEVEL SECURITY;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.cost_engine_systemmind FROM authenticated;

-- Seed a single current row (all zeros = free until the admin configures pricing).
INSERT INTO public.cost_engine_systemmind (
  base_charge_per_run_usd, charge_per_minute_usd, charge_per_1k_tokens_usd,
  charge_per_tool_call_usd, included_runs_per_month, included_seconds_per_month,
  included_tokens_per_month, overage_multiplier, notes, is_current
)
SELECT 0, 0, 0, 0, 0, 0, 0, 1, 'Default (unconfigured) SystemMind pricing — free.', TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.cost_engine_systemmind WHERE is_current = TRUE);

-- ── 6. workspace_workflows provenance columns (additive) ─────────────────────
ALTER TABLE public.workspace_workflows
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS source_build_session_id UUID,
  ADD COLUMN IF NOT EXISTS source_build_version INTEGER;

CREATE INDEX IF NOT EXISTS idx_ws_workflows_source_session
  ON public.workspace_workflows (source_build_session_id)
  WHERE source_build_session_id IS NOT NULL;

-- ── 7. updated_at triggers (reuse the automation-layer trigger fn) ───────────
CREATE OR REPLACE FUNCTION public.sm_automation_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sm_build_sessions_updated_at ON public.systemmind_build_sessions;
CREATE TRIGGER sm_build_sessions_updated_at
  BEFORE UPDATE ON public.systemmind_build_sessions
  FOR EACH ROW EXECUTE FUNCTION public.sm_automation_set_updated_at();

DROP TRIGGER IF EXISTS sm_build_versions_updated_at ON public.systemmind_build_versions;
CREATE TRIGGER sm_build_versions_updated_at
  BEFORE UPDATE ON public.systemmind_build_versions
  FOR EACH ROW EXECUTE FUNCTION public.sm_automation_set_updated_at();

DROP TRIGGER IF EXISTS cost_engine_systemmind_updated_at ON public.cost_engine_systemmind;
CREATE TRIGGER cost_engine_systemmind_updated_at
  BEFORE UPDATE ON public.cost_engine_systemmind
  FOR EACH ROW EXECUTE FUNCTION public.sm_automation_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- End of SystemMind Build Workspace migration
-- ─────────────────────────────────────────────────────────────────────────────
