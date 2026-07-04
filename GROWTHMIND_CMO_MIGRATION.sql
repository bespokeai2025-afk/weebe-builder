-- ─────────────────────────────────────────────────────────────────────────────
-- GrowthMind CMO Upgrade Migration
-- Apply this via the Supabase SQL Editor (Project → SQL Editor → New Query).
-- All statements use CREATE TABLE IF NOT EXISTS for idempotent re-runs.
-- RLS policies use the DO...EXCEPTION pattern (compatible with all PG versions).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. growthmind_service_scores ─────────────────────────────────────────────
-- Persists per-service Opportunity Index scores computed by the scoring engine.

CREATE TABLE IF NOT EXISTS growthmind_service_scores (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL,
  service_name   TEXT NOT NULL,
  total_score    INTEGER NOT NULL DEFAULT 0,
  scores         JSONB NOT NULL DEFAULT '{}',
  recommendation TEXT,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_service_scores_workspace
  ON growthmind_service_scores (workspace_id);

CREATE INDEX IF NOT EXISTS idx_gm_service_scores_total
  ON growthmind_service_scores (workspace_id, total_score DESC);

ALTER TABLE growthmind_service_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "growthmind_service_scores_workspace_isolation" ON growthmind_service_scores;
DO $$ BEGIN
  CREATE POLICY "growthmind_service_scores_workspace_members"
    ON growthmind_service_scores
    FOR ALL
    USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
    WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── 2. growthmind_trend_signals ───────────────────────────────────────────────
-- Trend signals computed from existing workspace data.
-- Classification: Emerging | Growing | Declining | Seasonal | Stable

CREATE TABLE IF NOT EXISTS growthmind_trend_signals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL,
  signal_type    TEXT NOT NULL,
  label          TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('Emerging','Growing','Declining','Seasonal','Stable')),
  current_value  NUMERIC NOT NULL DEFAULT 0,
  previous_value NUMERIC NOT NULL DEFAULT 0,
  change_percent NUMERIC,
  insight        TEXT,
  action_hint    TEXT,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_trend_signals_workspace
  ON growthmind_trend_signals (workspace_id);

CREATE INDEX IF NOT EXISTS idx_gm_trend_signals_computed
  ON growthmind_trend_signals (workspace_id, computed_at DESC);

ALTER TABLE growthmind_trend_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "growthmind_trend_signals_workspace_isolation" ON growthmind_trend_signals;
DO $$ BEGIN
  CREATE POLICY "growthmind_trend_signals_workspace_members"
    ON growthmind_trend_signals
    FOR ALL
    USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
    WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── 3. growthmind_campaign_proposals ─────────────────────────────────────────
-- AI-generated and deterministic campaign proposals.
-- status lifecycle: draft → approved | rejected

CREATE TABLE IF NOT EXISTS growthmind_campaign_proposals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL,
  title            TEXT NOT NULL,
  reason           TEXT,
  evidence         TEXT,
  audience         TEXT,
  expected_outcome TEXT,
  budget_estimate  TEXT,
  content_plan     TEXT,
  video_plan       TEXT,
  channels         TEXT[] NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected')),
  generated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_campaign_proposals_workspace
  ON growthmind_campaign_proposals (workspace_id);

CREATE INDEX IF NOT EXISTS idx_gm_campaign_proposals_status
  ON growthmind_campaign_proposals (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_gm_campaign_proposals_generated
  ON growthmind_campaign_proposals (workspace_id, generated_at DESC);

ALTER TABLE growthmind_campaign_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "growthmind_campaign_proposals_workspace_isolation" ON growthmind_campaign_proposals;
DO $$ BEGIN
  CREATE POLICY "growthmind_campaign_proposals_workspace_members"
    ON growthmind_campaign_proposals
    FOR ALL
    USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
    WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── 4. growthmind_video_proposals ────────────────────────────────────────────
-- Video campaign concepts generated by the Video Proposal Engine.
-- Same status lifecycle as campaign proposals.

CREATE TABLE IF NOT EXISTS growthmind_video_proposals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL,
  title            TEXT NOT NULL,
  hook             TEXT,
  platform         TEXT,
  target_audience  TEXT,
  storyboard       TEXT,
  creative_angles  TEXT[] NOT NULL DEFAULT '{}',
  expected_outcome TEXT,
  duration         TEXT,
  call_to_action   TEXT,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected')),
  generated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_video_proposals_workspace
  ON growthmind_video_proposals (workspace_id);

CREATE INDEX IF NOT EXISTS idx_gm_video_proposals_status
  ON growthmind_video_proposals (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_gm_video_proposals_generated
  ON growthmind_video_proposals (workspace_id, generated_at DESC);

ALTER TABLE growthmind_video_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "growthmind_video_proposals_workspace_isolation" ON growthmind_video_proposals;
DO $$ BEGIN
  CREATE POLICY "growthmind_video_proposals_workspace_members"
    ON growthmind_video_proposals
    FOR ALL
    USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
    WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- End of migration
-- ─────────────────────────────────────────────────────────────────────────────
