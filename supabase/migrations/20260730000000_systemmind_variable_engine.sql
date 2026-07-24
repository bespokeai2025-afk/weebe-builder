-- ─────────────────────────────────────────────────────────────────────────────
-- SystemMind Agent Scanner & Dynamic Variable Engine (Task foundation layer).
--
--   systemmind_agent_scans          — one row per scan run: the detected-
--                                     requirements report (variables found,
--                                     required integrations, credential NAMES
--                                     only, webhook events, booking/transfer
--                                     signals). Report is descriptive JSON;
--                                     the variable registry itself is
--                                     normalized below.
--   systemmind_dynamic_variables    — the per-agent dynamic variable registry.
--                                     One row per variable with real columns
--                                     for type, direction, sensitivity, status
--                                     and per-destination allow flags.
--   systemmind_variable_mappings    — source→destination mappings per variable
--                                     (a variable can flow in more than one
--                                     direction), each optionally referencing
--                                     a transformation rule.
--   systemmind_transformation_rules — reusable, individually testable
--                                     transformation rule configs.
--
-- RLS posture (established pattern): SELECT-only for workspace members; ALL
-- writes go through the service role (REVOKE writes from authenticated —
-- Supabase default grants give ALL).
--
-- SAFETY: credential VALUES are never stored anywhere in these tables — only
-- credential NAMES may appear in scan reports (enforced in server code via
-- assertNoCredentialValues).
--
-- Additive + idempotent: safe to re-run. Apply via
-- scripts/apply-systemmind-variable-engine-migration.mjs or the SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Scan runs / detected-requirements reports ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.systemmind_agent_scans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL,
  agent_id            UUID NOT NULL,
  created_by_user_id  UUID,
  status              TEXT NOT NULL DEFAULT 'completed' CHECK (status IN (
                        'completed','failed')),
  -- Descriptive report: { variables:[...names/sources], integrations:[...],
  --   credentialNames:[...], webhookEvents:[...], booking:{...}, transfer:{...},
  --   counts:{...} } — NO credential values ever.
  report              JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_inference_used   BOOLEAN NOT NULL DEFAULT FALSE,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sm_agent_scans_ws_agent
  ON public.systemmind_agent_scans (workspace_id, agent_id, created_at DESC);

-- ── Dynamic variable registry ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.systemmind_dynamic_variables (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL,
  agent_id            UUID NOT NULL,
  scan_id             UUID,
  name                TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  label               TEXT NOT NULL DEFAULT '',
  description         TEXT NOT NULL DEFAULT '',
  data_type           TEXT NOT NULL DEFAULT 'text' CHECK (data_type IN (
                        'text','number','currency','boolean','date','datetime',
                        'email','phone','url','address','single_select',
                        'multi_select','json','record_id')),
  is_required         BOOLEAN NOT NULL DEFAULT FALSE,
  default_value       TEXT NOT NULL DEFAULT '',
  example_value       TEXT NOT NULL DEFAULT '',
  -- Primary flow direction for this variable.
  direction           TEXT NOT NULL DEFAULT 'unassigned' CHECK (direction IN (
                        'unassigned','crm_to_webee','webee_to_retell_precall',
                        'retell_to_webee','webee_to_crm_postcall',
                        'retell_to_crm_via_webee','bidirectional')),
  -- Source / destination coordinates (system.object.field, descriptive).
  source_system       TEXT NOT NULL DEFAULT '',
  source_object       TEXT NOT NULL DEFAULT '',
  source_field        TEXT NOT NULL DEFAULT '',
  destination_system  TEXT NOT NULL DEFAULT '',
  destination_object  TEXT NOT NULL DEFAULT '',
  destination_field   TEXT NOT NULL DEFAULT '',
  validation_rule     TEXT NOT NULL DEFAULT '',
  fallback_value      TEXT NOT NULL DEFAULT '',
  sensitivity         TEXT NOT NULL DEFAULT 'standard' CHECK (sensitivity IN (
                        'standard','personal','sensitive_personal','financial','restricted')),
  -- Per-destination allow flags.
  allow_send_to_retell BOOLEAN NOT NULL DEFAULT TRUE,
  allow_store_in_webee BOOLEAN NOT NULL DEFAULT TRUE,
  allow_write_to_crm   BOOLEAN NOT NULL DEFAULT TRUE,
  -- Detection provenance + review lifecycle.
  var_class           TEXT NOT NULL DEFAULT 'custom',
  detected_sources    JSONB NOT NULL DEFAULT '[]'::jsonb, -- ["Global prompt", "Node: Ask budget", ...]
  confidence          TEXT CHECK (confidence IN ('high','medium','low')),
  status              TEXT NOT NULL DEFAULT 'detected' CHECK (status IN (
                        'detected','approved','edited','rejected')),
  reviewed_by_user_id UUID,
  reviewed_at         TIMESTAMPTZ,
  created_by_user_id  UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sm_dynamic_vars_ws_agent_name
  ON public.systemmind_dynamic_variables (workspace_id, agent_id, name);
CREATE INDEX IF NOT EXISTS idx_sm_dynamic_vars_ws_agent_status
  ON public.systemmind_dynamic_variables (workspace_id, agent_id, status);

-- ── Transformation rules (reusable + testable) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.systemmind_transformation_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL,
  name                TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  description         TEXT NOT NULL DEFAULT '',
  rule_type           TEXT NOT NULL CHECK (rule_type IN (
                        'date_format','phone_e164','currency_format','boolean_map',
                        'enum_map','concat','name_split','null_fallback',
                        'conditional','custom_json')),
  -- Rule-type-specific config (formats, maps, separators, conditions…).
  config              JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id  UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sm_transform_rules_ws_name
  ON public.systemmind_transformation_rules (workspace_id, name);
CREATE INDEX IF NOT EXISTS idx_sm_transform_rules_ws
  ON public.systemmind_transformation_rules (workspace_id, created_at DESC);

-- ── Variable mappings (a variable can flow in multiple directions) ───────────
CREATE TABLE IF NOT EXISTS public.systemmind_variable_mappings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL,
  variable_id         UUID NOT NULL REFERENCES public.systemmind_dynamic_variables(id) ON DELETE CASCADE,
  agent_id            UUID NOT NULL,
  direction           TEXT NOT NULL CHECK (direction IN (
                        'crm_to_webee','webee_to_retell_precall','retell_to_webee',
                        'webee_to_crm_postcall','retell_to_crm_via_webee','bidirectional')),
  source_system       TEXT NOT NULL DEFAULT '',
  source_object       TEXT NOT NULL DEFAULT '',
  source_field        TEXT NOT NULL DEFAULT '',
  destination_system  TEXT NOT NULL DEFAULT '',
  destination_object  TEXT NOT NULL DEFAULT '',
  destination_field   TEXT NOT NULL DEFAULT '',
  transformation_rule_id UUID REFERENCES public.systemmind_transformation_rules(id) ON DELETE SET NULL,
  is_required         BOOLEAN NOT NULL DEFAULT FALSE,
  is_ignored          BOOLEAN NOT NULL DEFAULT FALSE,
  notes               TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sm_var_mappings_var_direction
  ON public.systemmind_variable_mappings (variable_id, direction, destination_system, destination_field);
CREATE INDEX IF NOT EXISTS idx_sm_var_mappings_ws_agent
  ON public.systemmind_variable_mappings (workspace_id, agent_id);

-- ── RLS: members SELECT-only; writes are service-role-only ───────────────────
ALTER TABLE public.systemmind_agent_scans          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.systemmind_dynamic_variables    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.systemmind_transformation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.systemmind_variable_mappings    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sm_agent_scans_members" ON public.systemmind_agent_scans;
CREATE POLICY "sm_agent_scans_members" ON public.systemmind_agent_scans
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "sm_dynamic_vars_members" ON public.systemmind_dynamic_variables;
CREATE POLICY "sm_dynamic_vars_members" ON public.systemmind_dynamic_variables
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "sm_transform_rules_members" ON public.systemmind_transformation_rules;
CREATE POLICY "sm_transform_rules_members" ON public.systemmind_transformation_rules
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "sm_var_mappings_members" ON public.systemmind_variable_mappings;
CREATE POLICY "sm_var_mappings_members" ON public.systemmind_variable_mappings
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.systemmind_agent_scans          FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.systemmind_dynamic_variables    FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.systemmind_transformation_rules FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.systemmind_variable_mappings    FROM authenticated;
GRANT SELECT ON public.systemmind_agent_scans          TO authenticated;
GRANT SELECT ON public.systemmind_dynamic_variables    TO authenticated;
GRANT SELECT ON public.systemmind_transformation_rules TO authenticated;
GRANT SELECT ON public.systemmind_variable_mappings    TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- End of SystemMind variable engine migration
-- ─────────────────────────────────────────────────────────────────────────────
