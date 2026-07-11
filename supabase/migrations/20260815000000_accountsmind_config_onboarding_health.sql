-- ─────────────────────────────────────────────────────────────────────────────
-- AccountsMind Config Builder + Onboarding Assistant & Health Checks
--
--   accountsmind_field_defs      — workspace-scoped custom field definitions
--   accountsmind_stat_defs       — workspace-scoped stat/metric definitions
--   accountsmind_widget_defs     — workspace-scoped dashboard widget definitions
--   accountsmind_field_values    — values for custom fields against entities
--   workspace_setup_checklists   — SystemMind-proposed onboarding plans (items
--                                  carry check_key for derived re-checking)
--   workspace_health_runs        — on-demand scored health-check reports
--
-- All config rows are drafted by SystemMind through systemmind_generated_actions
-- (approval-first) and only inserted here as ACTIVE rows at activation time.
-- Rows are versioned (version + previous_version_id) and soft-deleted/archived —
-- never hard-deleted once data may reference them.
--
-- Additive + idempotent: safe to re-run. Apply manually to the shared Supabase
-- DB (Management API via scripts/apply-accountsmind-config-migration.mjs, or
-- the SQL Editor).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. accountsmind_field_defs ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accountsmind_field_defs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL,
  created_by_user_id  UUID,
  created_by_system   TEXT NOT NULL DEFAULT 'systemmind',
  source_draft_id     UUID,
  field_key           TEXT NOT NULL,
  label               TEXT NOT NULL,
  field_type          TEXT NOT NULL DEFAULT 'text'
                      CHECK (field_type IN ('text','number','currency','percentage','date','boolean','single_select','multi_select','status')),
  entity_type         TEXT NOT NULL DEFAULT 'client'
                      CHECK (entity_type IN ('client','lead','contact','campaign','agent','account')),
  appears_in          TEXT NOT NULL DEFAULT 'client_section'
                      CHECK (appears_in IN ('client_section','dashboard','both')),
  required            BOOLEAN NOT NULL DEFAULT FALSE,
  default_value       JSONB,
  options             JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation          JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_visible      BOOLEAN NOT NULL DEFAULT FALSE,
  risk_level          TEXT NOT NULL DEFAULT 'low'
                      CHECK (risk_level IN ('low','medium','high')),
  display_order       INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','paused','hidden','archived')),
  version             INTEGER NOT NULL DEFAULT 1,
  previous_version_id UUID,
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_am_field_defs_ws
  ON public.accountsmind_field_defs (workspace_id, status, display_order);
CREATE UNIQUE INDEX IF NOT EXISTS uq_am_field_defs_ws_key_active
  ON public.accountsmind_field_defs (workspace_id, field_key)
  WHERE status IN ('active','paused','hidden') AND is_deleted = FALSE;

ALTER TABLE public.accountsmind_field_defs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "am_field_defs_members" ON public.accountsmind_field_defs;
CREATE POLICY "am_field_defs_members" ON public.accountsmind_field_defs
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.accountsmind_field_defs FROM authenticated, anon;
GRANT SELECT ON public.accountsmind_field_defs TO authenticated;

-- ── 2. accountsmind_stat_defs ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accountsmind_stat_defs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL,
  created_by_user_id  UUID,
  created_by_system   TEXT NOT NULL DEFAULT 'systemmind',
  source_draft_id     UUID,
  stat_key            TEXT NOT NULL,
  label               TEXT NOT NULL,
  metric_key          TEXT NOT NULL,
  format              TEXT NOT NULL DEFAULT 'number'
                      CHECK (format IN ('number','currency','percentage','duration','count')),
  description         TEXT,
  client_visible      BOOLEAN NOT NULL DEFAULT FALSE,
  risk_level          TEXT NOT NULL DEFAULT 'low'
                      CHECK (risk_level IN ('low','medium','high')),
  display_order       INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','paused','hidden','archived')),
  version             INTEGER NOT NULL DEFAULT 1,
  previous_version_id UUID,
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_am_stat_defs_ws
  ON public.accountsmind_stat_defs (workspace_id, status, display_order);
CREATE UNIQUE INDEX IF NOT EXISTS uq_am_stat_defs_ws_key_active
  ON public.accountsmind_stat_defs (workspace_id, stat_key)
  WHERE status IN ('active','paused','hidden') AND is_deleted = FALSE;

ALTER TABLE public.accountsmind_stat_defs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "am_stat_defs_members" ON public.accountsmind_stat_defs;
CREATE POLICY "am_stat_defs_members" ON public.accountsmind_stat_defs
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.accountsmind_stat_defs FROM authenticated, anon;
GRANT SELECT ON public.accountsmind_stat_defs TO authenticated;

-- ── 3. accountsmind_widget_defs ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accountsmind_widget_defs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL,
  created_by_user_id  UUID,
  created_by_system   TEXT NOT NULL DEFAULT 'systemmind',
  source_draft_id     UUID,
  widget_key          TEXT NOT NULL,
  title               TEXT NOT NULL,
  widget_type         TEXT NOT NULL DEFAULT 'stat_card'
                      CHECK (widget_type IN ('stat_card','breakdown_list','progress','trend')),
  metric_key          TEXT NOT NULL,
  format              TEXT NOT NULL DEFAULT 'number'
                      CHECK (format IN ('number','currency','percentage','duration','count')),
  description         TEXT,
  client_visible      BOOLEAN NOT NULL DEFAULT FALSE,
  risk_level          TEXT NOT NULL DEFAULT 'low'
                      CHECK (risk_level IN ('low','medium','high')),
  display_order       INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','paused','hidden','archived')),
  version             INTEGER NOT NULL DEFAULT 1,
  previous_version_id UUID,
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_am_widget_defs_ws
  ON public.accountsmind_widget_defs (workspace_id, status, display_order);
CREATE UNIQUE INDEX IF NOT EXISTS uq_am_widget_defs_ws_key_active
  ON public.accountsmind_widget_defs (workspace_id, widget_key)
  WHERE status IN ('active','paused','hidden') AND is_deleted = FALSE;

ALTER TABLE public.accountsmind_widget_defs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "am_widget_defs_members" ON public.accountsmind_widget_defs;
CREATE POLICY "am_widget_defs_members" ON public.accountsmind_widget_defs
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.accountsmind_widget_defs FROM authenticated, anon;
GRANT SELECT ON public.accountsmind_widget_defs TO authenticated;

-- ── 4. accountsmind_field_values ─────────────────────────────────────────────
-- entity_id is TEXT (synced/derived rows use synthetic string ids, not UUIDs).
CREATE TABLE IF NOT EXISTS public.accountsmind_field_values (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL,
  field_def_id        UUID NOT NULL REFERENCES public.accountsmind_field_defs(id) ON DELETE CASCADE,
  entity_type         TEXT NOT NULL DEFAULT 'client',
  entity_id           TEXT NOT NULL,
  value               JSONB,
  updated_by_user_id  UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_am_field_values_def_entity
  ON public.accountsmind_field_values (workspace_id, field_def_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_am_field_values_ws_entity
  ON public.accountsmind_field_values (workspace_id, entity_type, entity_id);

ALTER TABLE public.accountsmind_field_values ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "am_field_values_members" ON public.accountsmind_field_values;
CREATE POLICY "am_field_values_members" ON public.accountsmind_field_values
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.accountsmind_field_values FROM authenticated, anon;
GRANT SELECT ON public.accountsmind_field_values TO authenticated;

-- ── 5. workspace_setup_checklists ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_setup_checklists (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL,
  created_by_user_id  UUID,
  created_by_system   TEXT NOT NULL DEFAULT 'systemmind',
  source_draft_id     UUID,
  title               TEXT NOT NULL DEFAULT 'Workspace setup plan',
  business_summary    TEXT,
  items               JSONB NOT NULL DEFAULT '[]'::jsonb,
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','archived')),
  version             INTEGER NOT NULL DEFAULT 1,
  previous_version_id UUID,
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ws_setup_checklists_ws
  ON public.workspace_setup_checklists (workspace_id, status, created_at DESC);

ALTER TABLE public.workspace_setup_checklists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ws_setup_checklists_members" ON public.workspace_setup_checklists;
CREATE POLICY "ws_setup_checklists_members" ON public.workspace_setup_checklists
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.workspace_setup_checklists FROM authenticated, anon;
GRANT SELECT ON public.workspace_setup_checklists TO authenticated;

-- ── 6. workspace_health_runs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_health_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL,
  created_by_user_id  UUID,
  created_by_system   TEXT NOT NULL DEFAULT 'systemmind',
  score               INTEGER,
  max_score           INTEGER,
  findings            JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary             TEXT,
  proposed_action_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  status              TEXT NOT NULL DEFAULT 'complete'
                      CHECK (status IN ('running','complete','failed')),
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ws_health_runs_ws
  ON public.workspace_health_runs (workspace_id, created_at DESC);

ALTER TABLE public.workspace_health_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ws_health_runs_members" ON public.workspace_health_runs;
CREATE POLICY "ws_health_runs_members" ON public.workspace_health_runs
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.workspace_health_runs FROM authenticated, anon;
GRANT SELECT ON public.workspace_health_runs TO authenticated;

-- ── 7. updated_at triggers ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.am_config_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS am_field_defs_updated_at ON public.accountsmind_field_defs;
CREATE TRIGGER am_field_defs_updated_at
  BEFORE UPDATE ON public.accountsmind_field_defs
  FOR EACH ROW EXECUTE FUNCTION public.am_config_set_updated_at();

DROP TRIGGER IF EXISTS am_stat_defs_updated_at ON public.accountsmind_stat_defs;
CREATE TRIGGER am_stat_defs_updated_at
  BEFORE UPDATE ON public.accountsmind_stat_defs
  FOR EACH ROW EXECUTE FUNCTION public.am_config_set_updated_at();

DROP TRIGGER IF EXISTS am_widget_defs_updated_at ON public.accountsmind_widget_defs;
CREATE TRIGGER am_widget_defs_updated_at
  BEFORE UPDATE ON public.accountsmind_widget_defs
  FOR EACH ROW EXECUTE FUNCTION public.am_config_set_updated_at();

DROP TRIGGER IF EXISTS am_field_values_updated_at ON public.accountsmind_field_values;
CREATE TRIGGER am_field_values_updated_at
  BEFORE UPDATE ON public.accountsmind_field_values
  FOR EACH ROW EXECUTE FUNCTION public.am_config_set_updated_at();

DROP TRIGGER IF EXISTS ws_setup_checklists_updated_at ON public.workspace_setup_checklists;
CREATE TRIGGER ws_setup_checklists_updated_at
  BEFORE UPDATE ON public.workspace_setup_checklists
  FOR EACH ROW EXECUTE FUNCTION public.am_config_set_updated_at();

DROP TRIGGER IF EXISTS ws_health_runs_updated_at ON public.workspace_health_runs;
CREATE TRIGGER ws_health_runs_updated_at
  BEFORE UPDATE ON public.workspace_health_runs
  FOR EACH ROW EXECUTE FUNCTION public.am_config_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- End of AccountsMind Config + Onboarding + Health Checks migration
-- ─────────────────────────────────────────────────────────────────────────────
