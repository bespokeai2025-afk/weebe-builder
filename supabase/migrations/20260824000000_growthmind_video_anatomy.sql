-- ══════════════════════════════════════════════════════════════════════════════
-- GrowthMind Video Anatomy (Phase 3) — multimodal deep analysis + adaptations
--
--   growthmind_content_anatomy — one Content Anatomy record per trend item
--   growthmind_discovery_runs  — run_kind extended: deep_analysis, adaptation
--   workspace_settings         — growthmind_deep_analysis_daily_limit
--
-- Adaptation briefs are stored in the existing growthmind_content_recommendations
-- table (payload JSONB). All idempotent / additive. RLS: members SELECT-only,
-- server-only writes (service_role).
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. growthmind_content_anatomy ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_content_anatomy (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL,
  trend_item_id  UUID NOT NULL,
  status         TEXT NOT NULL DEFAULT 'completed'
                 CHECK (status IN ('completed','partial','failed')),
  analysis_mode  TEXT NOT NULL DEFAULT 'metadata_only'
                 CHECK (analysis_mode IN ('video_url','video_inline','metadata_only')),
  transcript     TEXT,
  on_screen_text TEXT,
  anatomy        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- hook/format/structure/scenes/pacing/emotionalDriver/cta/audience/proof/successMechanism/relevance/reproductionDifficulty/risks/adaptationOpportunities
  model          TEXT,
  cost_estimate  NUMERIC(10,6) NOT NULL DEFAULT 0,
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_anatomy_ws_item
  ON public.growthmind_content_anatomy (workspace_id, trend_item_id);
CREATE INDEX IF NOT EXISTS idx_gm_anatomy_ws
  ON public.growthmind_content_anatomy (workspace_id, created_at DESC);
ALTER TABLE public.growthmind_content_anatomy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gm_anatomy_members" ON public.growthmind_content_anatomy;
CREATE POLICY "gm_anatomy_members" ON public.growthmind_content_anatomy
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.growthmind_content_anatomy FROM authenticated, anon;
GRANT SELECT ON public.growthmind_content_anatomy TO authenticated;

-- ── 2. growthmind_discovery_runs.run_kind — allow deep_analysis / adaptation ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'growthmind_discovery_runs_run_kind_check'
  ) THEN
    ALTER TABLE public.growthmind_discovery_runs
      DROP CONSTRAINT growthmind_discovery_runs_run_kind_check;
  END IF;
  ALTER TABLE public.growthmind_discovery_runs
    ADD CONSTRAINT growthmind_discovery_runs_run_kind_check
    CHECK (run_kind IN ('discovery','scoring','deep_analysis','adaptation'));
END $$;

-- ── 3. workspace_settings deep-analysis daily cap ─────────────────────────────
ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS growthmind_deep_analysis_daily_limit INTEGER NOT NULL DEFAULT 5;
