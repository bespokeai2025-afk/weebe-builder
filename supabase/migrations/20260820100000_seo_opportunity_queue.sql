-- SEO Opportunity Queue (Task: SEO autopilot with a ranked opportunity queue)
-- Server-written table (service role): members get SELECT only, writes revoked.
-- Idempotent / additive only.

CREATE TABLE IF NOT EXISTS public.growthmind_seo_opportunities (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL,
  property_url          text NOT NULL,
  kind                  text NOT NULL CHECK (kind IN (
                          'high_impression_low_ctr','title_meta_weak','near_page_one',
                          'declining_query','declining_page','missing_content',
                          'keyword_cannibalisation','indexing_issue','sitemap_missing',
                          'thin_or_outdated')),
  dim_key               text NOT NULL,
  title                 text NOT NULL,
  rationale             text NOT NULL,
  recommended_execution text NOT NULL CHECK (recommended_execution IN (
                          'create_article','refresh_content','metadata_change',
                          'page_change','internal_links','faq_section','sitemap_submit')),
  evidence              jsonb NOT NULL DEFAULT '{}'::jsonb,
  business_value        numeric NOT NULL,
  ranking_opportunity   numeric NOT NULL,
  confidence            numeric NOT NULL,
  effort                numeric NOT NULL,
  score                 numeric NOT NULL,
  status                text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','executing','handled','dismissed','expired')),
  dedupe_key            text NOT NULL,
  marketing_action_id   uuid,
  linked_campaign_id    uuid,
  linked_package_id     uuid,
  measurement           jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_detected_at      timestamptz NOT NULL DEFAULT now(),
  status_changed_at     timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- One live row per (workspace, dedupe_key) while it is open/executing/handled.
CREATE UNIQUE INDEX IF NOT EXISTS uq_seo_opps_ws_dedupe_live
  ON public.growthmind_seo_opportunities (workspace_id, dedupe_key)
  WHERE status IN ('open','executing','handled');

CREATE INDEX IF NOT EXISTS idx_seo_opps_ws_status_score
  ON public.growthmind_seo_opportunities (workspace_id, status, score DESC);

ALTER TABLE public.growthmind_seo_opportunities ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='seo_opps_members_read'
      AND polrelid='public.growthmind_seo_opportunities'::regclass) THEN
    CREATE POLICY seo_opps_members_read ON public.growthmind_seo_opportunities
      FOR SELECT TO authenticated
      USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
  END IF;
END $$;
REVOKE ALL ON public.growthmind_seo_opportunities FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.growthmind_seo_opportunities FROM authenticated;
GRANT SELECT ON public.growthmind_seo_opportunities TO authenticated;
