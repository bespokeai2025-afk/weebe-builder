-- HiveMind executive control over GrowthMind
-- 1. growthmind_objectives — commercial objectives HiveMind sets for GrowthMind
-- 2. workspace_settings pause/cost-limit switches

CREATE TABLE IF NOT EXISTS public.growthmind_objectives (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL,
  name                  TEXT NOT NULL,
  business_outcome      TEXT,
  target_audience       TEXT,
  target_product        TEXT,
  platforms             JSONB NOT NULL DEFAULT '[]'::jsonb,
  start_date            DATE,
  end_date              DATE,
  priority              TEXT NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('low','medium','high','critical')),
  budget_limit_usd      NUMERIC(12,2),
  content_volume        INTEGER,
  approval_requirements TEXT,
  success_metrics       JSONB NOT NULL DEFAULT '[]'::jsonb,
  workstreams           JSONB NOT NULL DEFAULT '[]'::jsonb,
  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','paused','completed','cancelled')),
  created_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gm_objectives_ws
  ON public.growthmind_objectives (workspace_id, status, priority);
ALTER TABLE public.growthmind_objectives ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gm_objectives_members" ON public.growthmind_objectives;
CREATE POLICY "gm_objectives_members" ON public.growthmind_objectives
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.growthmind_objectives FROM authenticated, anon;
GRANT SELECT ON public.growthmind_objectives TO authenticated;

ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS growthmind_publishing_paused BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS growthmind_jobs_paused BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS growthmind_monthly_cost_limit_usd NUMERIC(12,2);
