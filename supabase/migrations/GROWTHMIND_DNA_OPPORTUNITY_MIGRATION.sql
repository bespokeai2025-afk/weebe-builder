-- ═══════════════════════════════════════════════════════════════════════════════
-- GROWTHMIND BUSINESS DNA + OPPORTUNITY ENGINE MIGRATION
-- Append this block to COMBINED_PRODUCTION_MIGRATIONS.sql, then run once in
-- the Supabase SQL Editor. Every statement is safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- A. BUSINESS DNA (one row per workspace, upsert pattern)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS growthmind_business_dna (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  company_name             TEXT NOT NULL DEFAULT '',
  website                  TEXT NOT NULL DEFAULT '',
  industry                 TEXT NOT NULL DEFAULT '',
  products                 TEXT NOT NULL DEFAULT '',
  services                 TEXT NOT NULL DEFAULT '',
  pricing                  TEXT NOT NULL DEFAULT '',
  offers                   TEXT NOT NULL DEFAULT '',
  locations                TEXT NOT NULL DEFAULT '',
  ideal_customer_profiles  TEXT NOT NULL DEFAULT '',
  target_markets           TEXT NOT NULL DEFAULT '',
  unique_selling_points    TEXT NOT NULL DEFAULT '',
  competitors_summary      TEXT NOT NULL DEFAULT '',
  revenue_goals            TEXT NOT NULL DEFAULT '',
  monthly_marketing_budget NUMERIC(14,2),
  main_growth_objective    TEXT NOT NULL DEFAULT '',
  sales_process            TEXT NOT NULL DEFAULT '',
  average_deal_value       NUMERIC(14,2),
  profit_margin_pct        NUMERIC(6,2),
  best_customers           TEXT NOT NULL DEFAULT '',
  worst_customers          TEXT NOT NULL DEFAULT '',
  case_studies             TEXT NOT NULL DEFAULT '',
  brand_voice              TEXT NOT NULL DEFAULT '',
  compliance_notes         TEXT NOT NULL DEFAULT '',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE growthmind_business_dna ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "gm_dna_select" ON growthmind_business_dna FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_dna_insert" ON growthmind_business_dna FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_dna_update" ON growthmind_business_dna FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE ON growthmind_business_dna TO authenticated;
GRANT ALL ON growthmind_business_dna TO service_role;

-- Seed an empty DNA row for every existing workspace (idempotent)
INSERT INTO growthmind_business_dna (workspace_id)
SELECT id FROM workspaces
ON CONFLICT (workspace_id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- B. OPPORTUNITIES (cleared + re-inserted on each engine run)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS growthmind_opportunities (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  category             TEXT NOT NULL,
  evidence             TEXT NOT NULL DEFAULT '',
  expected_impact      TEXT NOT NULL DEFAULT '',
  confidence_score     NUMERIC(4,3) NOT NULL DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 1),
  urgency              TEXT NOT NULL DEFAULT 'medium' CHECK (urgency IN ('low','medium','high','critical')),
  recommended_action   TEXT NOT NULL DEFAULT '',
  estimated_effort     TEXT NOT NULL DEFAULT 'medium' CHECK (estimated_effort IN ('low','medium','high')),
  recommended_channel  TEXT NOT NULL DEFAULT '',
  related_assets       JSONB NOT NULL DEFAULT '[]',
  source_data          JSONB NOT NULL DEFAULT '{}',
  source_snapshot      JSONB NOT NULL DEFAULT '{}',
  last_calculated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gm_opps_ws_urgency ON growthmind_opportunities (workspace_id, urgency, confidence_score DESC);
CREATE INDEX IF NOT EXISTS gm_opps_ws_cat     ON growthmind_opportunities (workspace_id, category);
ALTER TABLE growthmind_opportunities ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "gm_opps_select" ON growthmind_opportunities FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_opps_insert" ON growthmind_opportunities FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_opps_delete" ON growthmind_opportunities FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, DELETE ON growthmind_opportunities TO authenticated;
GRANT ALL ON growthmind_opportunities TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- C. VALUE POINTS (keep history; current = most recent row)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS growthmind_value_points (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  current_highest_value TEXT NOT NULL,
  why_it_matters        TEXT NOT NULL DEFAULT '',
  who_to_target         TEXT NOT NULL DEFAULT '',
  best_channels         TEXT NOT NULL DEFAULT '',
  recommended_offer     TEXT NOT NULL DEFAULT '',
  recommended_campaign  TEXT NOT NULL DEFAULT '',
  recommended_content   TEXT NOT NULL DEFAULT '',
  recommended_follow_up TEXT NOT NULL DEFAULT '',
  confidence_score      NUMERIC(4,3) NOT NULL DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 1),
  evidence              TEXT NOT NULL DEFAULT '',
  source_snapshot       JSONB NOT NULL DEFAULT '{}',
  last_calculated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by_model    TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gm_vp_ws_recent ON growthmind_value_points (workspace_id, created_at DESC);
ALTER TABLE growthmind_value_points ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "gm_vp_select" ON growthmind_value_points FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_vp_insert" ON growthmind_value_points FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_vp_delete" ON growthmind_value_points FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, DELETE ON growthmind_value_points TO authenticated;
GRANT ALL ON growthmind_value_points TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- D. STRATEGIES (upsert on workspace_id + plan_period)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS growthmind_strategies (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_period        TEXT NOT NULL CHECK (plan_period IN ('30_day','60_day','90_day')),
  primary_angle      TEXT NOT NULL DEFAULT '',
  target_audience    TEXT NOT NULL DEFAULT '',
  core_offer         TEXT NOT NULL DEFAULT '',
  channels           JSONB NOT NULL DEFAULT '[]',
  campaigns          JSONB NOT NULL DEFAULT '[]',
  content_plan       TEXT NOT NULL DEFAULT '',
  seo_plan           TEXT NOT NULL DEFAULT '',
  paid_ads_plan      TEXT NOT NULL DEFAULT '',
  whatsapp_plan      TEXT NOT NULL DEFAULT '',
  email_plan         TEXT NOT NULL DEFAULT '',
  ai_calling_plan    TEXT NOT NULL DEFAULT '',
  follow_up_plan     TEXT NOT NULL DEFAULT '',
  kpis               JSONB NOT NULL DEFAULT '[]',
  expected_outcomes  TEXT NOT NULL DEFAULT '',
  tasks              JSONB NOT NULL DEFAULT '[]',
  confidence_score   NUMERIC(4,3) NOT NULL DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 1),
  evidence           TEXT NOT NULL DEFAULT '',
  source_snapshot    JSONB NOT NULL DEFAULT '{}',
  generated_by_model TEXT,
  last_calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, plan_period)
);
CREATE INDEX IF NOT EXISTS gm_strat_ws_period ON growthmind_strategies (workspace_id, plan_period);
ALTER TABLE growthmind_strategies ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "gm_strat_select" ON growthmind_strategies FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_strat_insert" ON growthmind_strategies FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_strat_update" ON growthmind_strategies FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_strat_delete" ON growthmind_strategies FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON growthmind_strategies TO authenticated;
GRANT ALL ON growthmind_strategies TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- E. CAMPAIGN DRAFTS (Campaign Factory — never auto-launched)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS growthmind_campaign_drafts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_type      TEXT NOT NULL,
  name               TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  target_audience    TEXT NOT NULL DEFAULT '',
  core_offer         TEXT NOT NULL DEFAULT '',
  budget             NUMERIC(14,2),
  goal               TEXT NOT NULL DEFAULT '',
  channels           JSONB NOT NULL DEFAULT '[]',
  copy_blocks        JSONB NOT NULL DEFAULT '[]',
  ad_structure       JSONB NOT NULL DEFAULT '{}',
  sequence           JSONB NOT NULL DEFAULT '[]',
  kpis               JSONB NOT NULL DEFAULT '[]',
  expected_outcome   TEXT NOT NULL DEFAULT '',
  confidence_score   NUMERIC(4,3) NOT NULL DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 1),
  evidence           TEXT NOT NULL DEFAULT '',
  source_snapshot    JSONB NOT NULL DEFAULT '{}',
  hivemind_action_id UUID,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent_for_approval','approved','rejected')),
  generated_by_model TEXT,
  last_calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gm_cdrafts_ws_type   ON growthmind_campaign_drafts (workspace_id, campaign_type, created_at DESC);
CREATE INDEX IF NOT EXISTS gm_cdrafts_ws_status ON growthmind_campaign_drafts (workspace_id, status);
ALTER TABLE growthmind_campaign_drafts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "gm_cdrafts_select" ON growthmind_campaign_drafts FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_cdrafts_insert" ON growthmind_campaign_drafts FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_cdrafts_update" ON growthmind_campaign_drafts FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_cdrafts_delete" ON growthmind_campaign_drafts FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON growthmind_campaign_drafts TO authenticated;
GRANT ALL ON growthmind_campaign_drafts TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- F. GENERATION AUDIT LOG
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS growthmind_generation_audit (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type     TEXT NOT NULL,
  entity_type    TEXT,
  entity_id      UUID,
  model_used     TEXT,
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  triggered_by   TEXT NOT NULL DEFAULT 'user',
  duration_ms    INTEGER,
  status         TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success','error','skipped')),
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gm_audit_ws_recent ON growthmind_generation_audit (workspace_id, created_at DESC);
ALTER TABLE growthmind_generation_audit ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "gm_audit_select" ON growthmind_generation_audit FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_audit_insert" ON growthmind_generation_audit FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT ON growthmind_generation_audit TO authenticated;
GRANT ALL ON growthmind_generation_audit TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- G. AUTO-SEED DNA FOR NEW WORKSPACES via trigger
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_growthmind_defaults()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.growthmind_business_dna (workspace_id)
  VALUES (NEW.id)
  ON CONFLICT (workspace_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_growthmind_defaults ON public.workspaces;
CREATE TRIGGER trg_seed_growthmind_defaults
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.seed_growthmind_defaults();
