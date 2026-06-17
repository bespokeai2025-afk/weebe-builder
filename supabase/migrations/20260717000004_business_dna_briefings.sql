-- ── Business DNA Confidence Layer + Briefings + Campaign Package Extension ─────
-- Migration: 20260717000004
-- Apply manually in Supabase SQL Editor.
--
-- 1. Extend growthmind_business_dna with confidence tracking + new spec fields
-- 2. Create hivemind_briefings (stored daily/weekly/monthly briefings)
-- 3. Extend growthmind_campaign_proposals with 15-section package fields

-- ── 1. Extend growthmind_business_dna ─────────────────────────────────────────

-- Confidence layer (maps field_key → {score, source, last_updated})
ALTER TABLE public.growthmind_business_dna
  ADD COLUMN IF NOT EXISTS confidence_scores  JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS discovery_sources  JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_discovery_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discovery_run_count INT NOT NULL DEFAULT 0;

-- New spec fields (all safe to add; default to empty string)
ALTER TABLE public.growthmind_business_dna
  ADD COLUMN IF NOT EXISTS sub_industry          TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS country               TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS target_countries      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lead_sources          TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS target_job_titles     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS target_company_sizes  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS target_industries     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS qualification_criteria TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS business_goals        TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS marketing_goals       TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS current_crm           TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS current_calendar      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS current_telephony     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS current_ad_platforms  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS current_analytics     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tone_of_voice         TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS brand_style           TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS risk_tolerance        TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS growth_targets        TEXT NOT NULL DEFAULT '';

-- ── 2. hivemind_briefings ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hivemind_briefings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  type         TEXT NOT NULL DEFAULT 'daily',
  -- 'daily' | 'weekly' | 'monthly'
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  sections     JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- { executive_summary, what_happened, what_changed, what_worked,
  --   what_failed, next_actions, recommended_campaigns, key_metrics }
  meta         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- { leads_count, calls_count, conversion_rate, revenue_pence, highlights }
  is_read      BOOLEAN NOT NULL DEFAULT false,
  generated_by TEXT NOT NULL DEFAULT 'scheduler',
  -- 'scheduler' | 'manual'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hb_ws_type_idx ON public.hivemind_briefings(workspace_id, type, created_at DESC);
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

-- ── 3. Extend growthmind_campaign_proposals ────────────────────────────────────
-- Full 15-section campaign package fields
ALTER TABLE public.growthmind_campaign_proposals
  ADD COLUMN IF NOT EXISTS video_prompt        TEXT,
  ADD COLUMN IF NOT EXISTS image_prompt        TEXT,
  ADD COLUMN IF NOT EXISTS ad_copy             JSONB DEFAULT '{}'::jsonb,
  -- { headlines: [], body: [], cta: [], platform_variants: {} }
  ADD COLUMN IF NOT EXISTS email_sequence      JSONB DEFAULT '[]'::jsonb,
  -- [ { day, subject, body, cta } ]
  ADD COLUMN IF NOT EXISTS whatsapp_sequence   JSONB DEFAULT '[]'::jsonb,
  -- [ { day, message, media_suggestion } ]
  ADD COLUMN IF NOT EXISTS follow_up_campaign  JSONB DEFAULT '{}'::jsonb,
  -- { strategy, timeline_days, call_script_hint }
  ADD COLUMN IF NOT EXISTS call_campaign       JSONB DEFAULT '{}'::jsonb,
  -- { objective, target_list_filter, ai_agent_type, call_script_hint }
  ADD COLUMN IF NOT EXISTS landing_page_rec    TEXT,
  ADD COLUMN IF NOT EXISTS measurement_strategy JSONB DEFAULT '{}'::jsonb,
  -- { kpis: [], tracking: [], review_cadence }
  ADD COLUMN IF NOT EXISTS estimated_leads      INT,
  ADD COLUMN IF NOT EXISTS estimated_cpl_pence  INT,
  ADD COLUMN IF NOT EXISTS expected_roi_pct     INT,
  ADD COLUMN IF NOT EXISTS estimated_cost_pence INT,
  ADD COLUMN IF NOT EXISTS dna_snapshot        JSONB DEFAULT '{}'::jsonb,
  -- snapshot of DNA used to generate (for transparency/audit)
  ADD COLUMN IF NOT EXISTS package_complete    BOOLEAN NOT NULL DEFAULT false;
  -- true once all 15 sections are populated
