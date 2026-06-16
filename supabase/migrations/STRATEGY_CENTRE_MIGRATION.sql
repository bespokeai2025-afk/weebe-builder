-- ── GrowthMind Strategy Centre ─────────────────────────────────────────────────
-- Run this manually in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS growthmind_strategy_centre (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid        NOT NULL,
  strategy_type          text        NOT NULL,
  status                 text        NOT NULL DEFAULT 'draft',

  -- Service selection (AI-scored)
  selected_service       text,
  service_selection_reason text,
  service_scores         jsonb       DEFAULT '{}',

  -- Core strategy content
  executive_summary      text,
  target_audience        text,
  channel_recommendation text[]      DEFAULT '{}',
  budget_recommendation  text,
  expected_outcome       text,

  -- Per-engine plans
  campaign_plan          text,
  content_plan           text,
  video_plan             text,
  seo_plan               text,
  whatsapp_plan          text,
  email_plan             text,
  ai_calling_plan        text,
  landing_page_plan      text,

  -- Structured output
  kpis                   jsonb       DEFAULT '[]',
  risks                  text,
  required_assets        jsonb       DEFAULT '[]',
  approval_actions       jsonb       DEFAULT '[]',

  -- Meta
  prompt_engines_used    text[]      DEFAULT '{}',
  source_data_snapshot   jsonb       DEFAULT '{}',
  confidence_score       numeric(4,3) DEFAULT 0,
  generated_by_model     text,
  hivemind_action_id     uuid,
  rejection_reason       text,

  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_strategy_centre_ws
  ON growthmind_strategy_centre(workspace_id);
CREATE INDEX IF NOT EXISTS idx_gm_strategy_centre_status
  ON growthmind_strategy_centre(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_gm_strategy_centre_created
  ON growthmind_strategy_centre(workspace_id, created_at DESC);

-- ── Strategy Assets (per-engine generated drafts) ───────────────────────────────
CREATE TABLE IF NOT EXISTS growthmind_strategy_assets (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL,
  strategy_id  uuid        NOT NULL REFERENCES growthmind_strategy_centre(id) ON DELETE CASCADE,
  engine       text        NOT NULL,
  asset_type   text        NOT NULL,
  title        text,
  content      text,
  metadata     jsonb       DEFAULT '{}',
  status       text        DEFAULT 'draft',
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_strategy_assets_strategy
  ON growthmind_strategy_assets(strategy_id);

-- ── Strategy Tasks (created on approval) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS growthmind_strategy_tasks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL,
  strategy_id  uuid        NOT NULL REFERENCES growthmind_strategy_centre(id) ON DELETE CASCADE,
  title        text        NOT NULL,
  description  text,
  channel      text,
  priority     text        DEFAULT 'medium',
  week_number  integer,
  status       text        DEFAULT 'pending',
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_strategy_tasks_strategy
  ON growthmind_strategy_tasks(strategy_id);

-- ── Prompt Runs (engine execution log) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS growthmind_prompt_runs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL,
  strategy_id   uuid,
  engine        text        NOT NULL,
  prompt_type   text,
  input_context jsonb       DEFAULT '{}',
  output_text   text,
  model_used    text,
  tokens_used   integer,
  duration_ms   integer,
  status        text        DEFAULT 'success',
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_prompt_runs_ws
  ON growthmind_prompt_runs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_prompt_runs_strategy
  ON growthmind_prompt_runs(strategy_id);

-- ── Row-Level Security ───────────────────────────────────────────────────────────
ALTER TABLE growthmind_strategy_centre   ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_strategy_assets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_strategy_tasks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_prompt_runs       ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY "gm_sc_select"  ON growthmind_strategy_centre FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_sc_insert"  ON growthmind_strategy_centre FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_sc_update"  ON growthmind_strategy_centre FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_sc_delete"  ON growthmind_strategy_centre FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON growthmind_strategy_centre TO authenticated;
GRANT ALL ON growthmind_strategy_centre TO service_role;

DO $$ BEGIN CREATE POLICY "gm_sa_select"  ON growthmind_strategy_assets FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_sa_insert"  ON growthmind_strategy_assets FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_sa_delete"  ON growthmind_strategy_assets FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON growthmind_strategy_assets TO authenticated;
GRANT ALL ON growthmind_strategy_assets TO service_role;

DO $$ BEGIN CREATE POLICY "gm_st_select"  ON growthmind_strategy_tasks FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_st_insert"  ON growthmind_strategy_tasks FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_st_update"  ON growthmind_strategy_tasks FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON growthmind_strategy_tasks TO authenticated;
GRANT ALL ON growthmind_strategy_tasks TO service_role;

DO $$ BEGIN CREATE POLICY "gm_pr_select"  ON growthmind_prompt_runs FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_pr_insert"  ON growthmind_prompt_runs FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT ON growthmind_prompt_runs TO authenticated;
GRANT ALL ON growthmind_prompt_runs TO service_role;

-- ── Missing policies (added post-audit) ─────────────────────────────────────────

-- growthmind_strategy_assets: UPDATE policy was missing (needed for status changes)
DO $$ BEGIN CREATE POLICY "gm_sa_update"  ON growthmind_strategy_assets FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- growthmind_strategy_tasks: DELETE policy was missing
DO $$ BEGIN CREATE POLICY "gm_st_delete"  ON growthmind_strategy_tasks FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Missing indexes (added post-audit) ──────────────────────────────────────────

-- workspace_id indexes on assets and tasks for direct workspace-scoped queries
CREATE INDEX IF NOT EXISTS idx_gm_strategy_assets_ws
  ON growthmind_strategy_assets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_gm_strategy_tasks_ws
  ON growthmind_strategy_tasks(workspace_id);
