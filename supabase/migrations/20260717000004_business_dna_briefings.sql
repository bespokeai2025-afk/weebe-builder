-- ── Business DNA Confidence Layer + Briefings + Campaign Package Extension ─────
-- Migration: 20260717000004
-- Apply manually in Supabase SQL Editor.
--
-- SELF-CONTAINED: creates growthmind_business_dna and growthmind_campaign_proposals
-- if they don't already exist, then extends them with new columns.
--
-- 1. Ensure growthmind_business_dna exists + extend with confidence/spec fields
-- 2. Create hivemind_briefings (stored daily/weekly/monthly briefings)
-- 3. Ensure growthmind_campaign_proposals exists + extend with 15-section package fields

-- ── 1. growthmind_business_dna ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.growthmind_business_dna (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.growthmind_business_dna ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "gm_dna_select" ON public.growthmind_business_dna
    FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "gm_dna_insert" ON public.growthmind_business_dna
    FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "gm_dna_update" ON public.growthmind_business_dna
    FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE ON public.growthmind_business_dna TO authenticated;
GRANT ALL ON public.growthmind_business_dna TO service_role;

-- Seed an empty DNA row for every existing workspace (idempotent)
INSERT INTO public.growthmind_business_dna (workspace_id)
SELECT id FROM public.workspaces
ON CONFLICT (workspace_id) DO NOTHING;

-- Confidence layer columns
ALTER TABLE public.growthmind_business_dna
  ADD COLUMN IF NOT EXISTS confidence_scores   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS discovery_sources   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_discovery_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discovery_run_count INT NOT NULL DEFAULT 0;

-- New spec fields
ALTER TABLE public.growthmind_business_dna
  ADD COLUMN IF NOT EXISTS sub_industry            TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS country                 TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS target_countries        TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lead_sources            TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS target_job_titles       TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS target_company_sizes    TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS target_industries       TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS qualification_criteria  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS business_goals          TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS marketing_goals         TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS current_crm             TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS current_calendar        TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS current_telephony       TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS current_ad_platforms    TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS current_analytics       TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tone_of_voice           TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS brand_style             TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS risk_tolerance          TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS growth_targets          TEXT NOT NULL DEFAULT '';

-- ── 2. hivemind_briefings ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hivemind_briefings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  type         TEXT NOT NULL DEFAULT 'daily',
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  sections     JSONB NOT NULL DEFAULT '{}'::jsonb,
  meta         JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read      BOOLEAN NOT NULL DEFAULT false,
  generated_by TEXT NOT NULL DEFAULT 'scheduler',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hb_ws_type_idx   ON public.hivemind_briefings(workspace_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS hb_ws_unread_idx ON public.hivemind_briefings(workspace_id, is_read, created_at DESC);

ALTER TABLE public.hivemind_briefings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hb_sel" ON public.hivemind_briefings;
DROP POLICY IF EXISTS "hb_upd" ON public.hivemind_briefings;

CREATE POLICY "hb_sel" ON public.hivemind_briefings FOR SELECT
  USING (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()));
CREATE POLICY "hb_upd" ON public.hivemind_briefings FOR UPDATE
  USING (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()));

GRANT SELECT, UPDATE ON public.hivemind_briefings TO authenticated;
GRANT ALL ON public.hivemind_briefings TO service_role;

-- ── 3. growthmind_campaign_proposals ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.growthmind_campaign_proposals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL,
  title                 TEXT NOT NULL,
  reason                TEXT,
  evidence              TEXT,
  audience              TEXT,
  expected_outcome      TEXT,
  budget_estimate       TEXT,
  content_plan          TEXT,
  video_plan            TEXT,
  channels              TEXT[] NOT NULL DEFAULT '{}',
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected')),
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  video_prompt          TEXT,
  image_prompt          TEXT,
  ad_copy               JSONB DEFAULT '{}'::jsonb,
  email_sequence        JSONB DEFAULT '[]'::jsonb,
  whatsapp_sequence     JSONB DEFAULT '[]'::jsonb,
  follow_up_campaign    JSONB DEFAULT '{}'::jsonb,
  call_campaign         JSONB DEFAULT '{}'::jsonb,
  landing_page_rec      TEXT,
  measurement_strategy  JSONB DEFAULT '{}'::jsonb,
  estimated_leads       INT,
  estimated_cpl_pence   INT,
  expected_roi_pct      INT,
  estimated_cost_pence  INT,
  dna_snapshot          JSONB DEFAULT '{}'::jsonb,
  package_complete      BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_gm_campaign_proposals_workspace
  ON public.growthmind_campaign_proposals (workspace_id);
CREATE INDEX IF NOT EXISTS idx_gm_campaign_proposals_status
  ON public.growthmind_campaign_proposals (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_gm_campaign_proposals_generated
  ON public.growthmind_campaign_proposals (workspace_id, generated_at DESC);

ALTER TABLE public.growthmind_campaign_proposals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "growthmind_campaign_proposals_workspace_isolation"
    ON public.growthmind_campaign_proposals
    USING (workspace_id::text = (current_setting('app.workspace_id', true)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.growthmind_campaign_proposals TO authenticated;
GRANT ALL ON public.growthmind_campaign_proposals TO service_role;

-- Extend with 15-section campaign package fields
ALTER TABLE public.growthmind_campaign_proposals
  ADD COLUMN IF NOT EXISTS video_prompt          TEXT,
  ADD COLUMN IF NOT EXISTS image_prompt          TEXT,
  ADD COLUMN IF NOT EXISTS ad_copy               JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS email_sequence        JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS whatsapp_sequence     JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS follow_up_campaign    JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS call_campaign         JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS landing_page_rec      TEXT,
  ADD COLUMN IF NOT EXISTS measurement_strategy  JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS estimated_leads       INT,
  ADD COLUMN IF NOT EXISTS estimated_cpl_pence   INT,
  ADD COLUMN IF NOT EXISTS expected_roi_pct      INT,
  ADD COLUMN IF NOT EXISTS estimated_cost_pence  INT,
  ADD COLUMN IF NOT EXISTS dna_snapshot          JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS package_complete      BOOLEAN NOT NULL DEFAULT false;
