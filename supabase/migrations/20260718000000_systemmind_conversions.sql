-- ─────────────────────────────────────────────────────────────────────────────
-- SystemMind Legacy Logic Converter — conversion lineage + audit.
--
--   systemmind_conversions — one row per legacy→WEBEE conversion. Records WHERE
--   a Build Workspace draft came from (source type/id/version), the structured
--   conversion report (mapped blocks, unsupported logic, warnings, assumptions),
--   and the lineage into the Build Workspace (session_id + seeded version_id).
--
--   Lifecycle status intentionally does NOT live here — the seeded build
--   version carries the draft→testing→applied lifecycle, and approvals route
--   through the existing HiveMind pipeline. This table is immutable lineage.
--
-- RLS posture (established pattern): SELECT-only for workspace members; ALL
-- writes go through the service role (REVOKE writes from authenticated —
-- Supabase default grants give ALL).
--
-- Additive + idempotent: safe to re-run. Apply via
-- scripts/apply-systemmind-conversions-migration.mjs (Management API) or the
-- Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.systemmind_conversions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL,
  created_by_user_id UUID,
  -- Where the logic came from
  source_type        TEXT NOT NULL CHECK (source_type IN (
                       'agent','workflow','n8n','hexmail_sequence',
                       'wati_setup','webform_auto_call','manual_description')),
  source_id          TEXT,
  source_name        TEXT,
  source_version     TEXT,
  converted_by       TEXT NOT NULL DEFAULT 'systemmind',
  -- Lineage into the Build Workspace
  session_id         UUID,
  version_id         UUID,
  -- Conversion quality + risk at conversion time
  fidelity           TEXT NOT NULL DEFAULT 'partial'
                     CHECK (fidelity IN ('full','partial','assisted')),
  risk_level         TEXT,
  -- Full structured conversion report (never contains credential values)
  report             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sm_conversions_ws_created
  ON public.systemmind_conversions (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sm_conversions_session
  ON public.systemmind_conversions (session_id) WHERE session_id IS NOT NULL;

ALTER TABLE public.systemmind_conversions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sm_conversions_members" ON public.systemmind_conversions;
CREATE POLICY "sm_conversions_members" ON public.systemmind_conversions
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.systemmind_conversions FROM authenticated;
GRANT SELECT ON public.systemmind_conversions TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- End of SystemMind conversions migration
-- ─────────────────────────────────────────────────────────────────────────────
