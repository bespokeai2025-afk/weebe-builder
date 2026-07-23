-- ══════════════════════════════════════════════════════════════════════════════
-- GrowthMind Trend Scout (Phase 2) — discovery run logs + workspace cost controls
--
--   growthmind_discovery_runs — per-run, per-source outcome log with cost estimate
--   workspace_settings        — growthmind_discovery_daily_limit,
--                               growthmind_min_opportunity_score,
--                               growthmind_last_discovery_date
--
-- All idempotent / additive. RLS: members SELECT-only, server-only writes
-- (service_role), matching the Phase 1 content-intelligence tables.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. growthmind_discovery_runs ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_discovery_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  run_kind      TEXT NOT NULL DEFAULT 'discovery'
                CHECK (run_kind IN ('discovery','scoring')),
  source        TEXT NOT NULL,                       -- internal | owned_meta | ig_business_discovery | meta_ad_library | google_trends | youtube | reddit | news | scoring_deterministic | scoring_ai
  status        TEXT NOT NULL
                CHECK (status IN ('success','error','skipped')),
  items_found   INTEGER NOT NULL DEFAULT 0,
  items_new     INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  skip_reason   TEXT,
  cost_estimate NUMERIC(10,6) NOT NULL DEFAULT 0,    -- estimated USD cost (AI calls); 0 for free sources
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  triggered_by  TEXT NOT NULL DEFAULT 'scheduler'
                CHECK (triggered_by IN ('scheduler','user')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gm_discovery_runs_ws
  ON public.growthmind_discovery_runs (workspace_id, created_at DESC);
ALTER TABLE public.growthmind_discovery_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gm_discovery_runs_members" ON public.growthmind_discovery_runs;
CREATE POLICY "gm_discovery_runs_members" ON public.growthmind_discovery_runs
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.growthmind_discovery_runs FROM authenticated, anon;
GRANT SELECT ON public.growthmind_discovery_runs TO authenticated;

-- ── 2. workspace_settings cost-control columns ────────────────────────────────
ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS growthmind_discovery_daily_limit INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS growthmind_min_opportunity_score INTEGER NOT NULL DEFAULT 55,
  ADD COLUMN IF NOT EXISTS growthmind_trend_scout_enabled   BOOLEAN NOT NULL DEFAULT TRUE;
