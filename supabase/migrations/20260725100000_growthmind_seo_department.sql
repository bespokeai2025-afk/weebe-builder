-- GrowthMind SEO Department: GSC sync engine + SEO campaigns + teachings + deployment packages.
-- Idempotent / additive only. Workspace-members RLS pattern.
-- Sync tables are SERVER-WRITTEN (service role): members get SELECT only, writes revoked.

-- ── growthmind_gsc_sync_state ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_gsc_sync_state (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL,
  property_url          text NOT NULL,
  status                text NOT NULL DEFAULT 'idle'
                        CHECK (status IN ('idle','syncing','completed','baseline_pending','failed')),
  baseline_pending      boolean NOT NULL DEFAULT false,
  requested_start_date  date,
  requested_end_date    date,
  last_complete_date    date,
  rows_imported         integer NOT NULL DEFAULT 0,
  sync_kind             text NOT NULL DEFAULT 'initial' CHECK (sync_kind IN ('initial','incremental')),
  quota                 jsonb,
  warnings              jsonb NOT NULL DEFAULT '[]'::jsonb,
  retry_state           jsonb,
  error_message         text,
  connection            jsonb,
  freshness             jsonb,
  last_synced_at        timestamptz,
  next_sync_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gsc_sync_state_ws_prop
  ON public.growthmind_gsc_sync_state (workspace_id, property_url);
ALTER TABLE public.growthmind_gsc_sync_state ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='gsc_sync_state_members_read'
      AND polrelid='public.growthmind_gsc_sync_state'::regclass) THEN
    CREATE POLICY gsc_sync_state_members_read ON public.growthmind_gsc_sync_state
      FOR SELECT TO authenticated
      USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
  END IF;
END $$;
REVOKE INSERT, UPDATE, DELETE ON public.growthmind_gsc_sync_state FROM authenticated;
REVOKE ALL ON public.growthmind_gsc_sync_state FROM anon;

-- ── growthmind_gsc_performance ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_gsc_performance (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  property_url  text NOT NULL,
  date          date NOT NULL,
  dimension     text NOT NULL CHECK (dimension IN ('query','page','country','device','search_appearance')),
  dim_key       text NOT NULL,
  clicks        integer NOT NULL DEFAULT 0,
  impressions   integer NOT NULL DEFAULT 0,
  ctr           numeric,
  position      numeric,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gsc_perf_ws_prop_date_dim_key
  ON public.growthmind_gsc_performance (workspace_id, property_url, date, dimension, dim_key);
CREATE INDEX IF NOT EXISTS idx_gsc_perf_ws_dim_date
  ON public.growthmind_gsc_performance (workspace_id, dimension, date DESC);
ALTER TABLE public.growthmind_gsc_performance ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='gsc_perf_members_read'
      AND polrelid='public.growthmind_gsc_performance'::regclass) THEN
    CREATE POLICY gsc_perf_members_read ON public.growthmind_gsc_performance
      FOR SELECT TO authenticated
      USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
  END IF;
END $$;
REVOKE INSERT, UPDATE, DELETE ON public.growthmind_gsc_performance FROM authenticated;
REVOKE ALL ON public.growthmind_gsc_performance FROM anon;

-- ── growthmind_gsc_sitemaps ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_gsc_sitemaps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL,
  property_url    text NOT NULL,
  path            text NOT NULL,
  last_submitted  timestamptz,
  last_downloaded timestamptz,
  is_pending      boolean NOT NULL DEFAULT false,
  is_index        boolean NOT NULL DEFAULT false,
  errors          integer NOT NULL DEFAULT 0,
  warnings        integer NOT NULL DEFAULT 0,
  contents        jsonb,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gsc_sitemaps_ws_prop_path
  ON public.growthmind_gsc_sitemaps (workspace_id, property_url, path);
ALTER TABLE public.growthmind_gsc_sitemaps ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='gsc_sitemaps_members_read'
      AND polrelid='public.growthmind_gsc_sitemaps'::regclass) THEN
    CREATE POLICY gsc_sitemaps_members_read ON public.growthmind_gsc_sitemaps
      FOR SELECT TO authenticated
      USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
  END IF;
END $$;
REVOKE INSERT, UPDATE, DELETE ON public.growthmind_gsc_sitemaps FROM authenticated;
REVOKE ALL ON public.growthmind_gsc_sitemaps FROM anon;

-- ── growthmind_gsc_inspections ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_gsc_inspections (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL,
  property_url      text NOT NULL,
  url               text NOT NULL,
  verdict           text,
  coverage_state    text,
  robots_txt_state  text,
  indexing_state    text,
  page_fetch_state  text,
  last_crawl_time   timestamptz,
  google_canonical  text,
  user_canonical    text,
  raw               jsonb,
  inspected_at      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gsc_inspections_ws_prop_url
  ON public.growthmind_gsc_inspections (workspace_id, property_url, url);
ALTER TABLE public.growthmind_gsc_inspections ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='gsc_inspections_members_read'
      AND polrelid='public.growthmind_gsc_inspections'::regclass) THEN
    CREATE POLICY gsc_inspections_members_read ON public.growthmind_gsc_inspections
      FOR SELECT TO authenticated
      USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
  END IF;
END $$;
REVOKE INSERT, UPDATE, DELETE ON public.growthmind_gsc_inspections FROM authenticated;
REVOKE ALL ON public.growthmind_gsc_inspections FROM anon;

-- ── growthmind_seo_campaigns ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_seo_campaigns (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid NOT NULL,
  work_order_id          uuid,
  task_id                uuid,
  campaign_type          text NOT NULL DEFAULT 'blog'
                         CHECK (campaign_type IN ('strategy','general','product','service','industry','country','local','existing_page_improvement','content_refresh','internal_link','metadata','technical','blog')),
  name                   text NOT NULL,
  status                 text NOT NULL DEFAULT 'proposed'
                         CHECK (status IN ('proposed','awaiting_details','awaiting_strategy_approval','planning','executing_analysis','drafting','awaiting_brief_approval','awaiting_content_approval','awaiting_technical_approval','awaiting_website_deployment','awaiting_deployment_approval','deploying','verifying','monitoring','partially_completed','completed','blocked','failed','cancelled')),
  parent_objective       text,
  parent_strategy_id     uuid,
  product_service        text,
  ideal_reader           text,
  target_industry        text,
  target_country         text,
  language               text,
  customer_problem       text,
  search_intent          text,
  primary_topic          text,
  query_cluster          jsonb NOT NULL DEFAULT '[]'::jsonb,
  gsc_evidence           jsonb,
  data_limitations       jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_pages          jsonb,
  competing_pages        jsonb,
  page_decision          text CHECK (page_decision IN ('update_existing','create_new','consolidate','do_not_create')),
  page_decision_reason   text,
  proposed_url           text,
  proposed_title         text,
  meta_title             text,
  meta_description       text,
  h1                     text,
  outline                jsonb,
  brief                  jsonb,
  content_project_id     uuid,
  deployment_package_id  uuid,
  approvals              jsonb NOT NULL DEFAULT '[]'::jsonb,
  safety_results         jsonb,
  monitoring             jsonb,
  evidence               jsonb,
  blocked_reason         text,
  created_by_user_id     uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  completed_at           timestamptz
);
CREATE INDEX IF NOT EXISTS idx_seo_campaigns_ws_status
  ON public.growthmind_seo_campaigns (workspace_id, status, updated_at DESC);
ALTER TABLE public.growthmind_seo_campaigns ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='seo_campaigns_members'
      AND polrelid='public.growthmind_seo_campaigns'::regclass) THEN
    CREATE POLICY seo_campaigns_members ON public.growthmind_seo_campaigns
      FOR ALL TO authenticated
      USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
      WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
  END IF;
END $$;
REVOKE ALL ON public.growthmind_seo_campaigns FROM anon;

-- ── growthmind_seo_teachings ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_seo_teachings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL,
  teaching_type         text NOT NULL
                        CHECK (teaching_type IN ('priority_product','priority_service','target_industry','target_country','target_language','customer_problem','customer_question','sales_objection','search_topic','topic_to_avoid','competitor','restricted_claim','preferred_cta','publishing_limit','approval_requirement','commercial_objective','temporary_instruction','experiment')),
  content               text NOT NULL,
  source                text NOT NULL DEFAULT 'user' CHECK (source IN ('user','chat','dna','system')),
  owner_user_id         uuid,
  confidence            numeric NOT NULL DEFAULT 1.0,
  status                text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','expired','retracted','confirmed','contradicted')),
  expires_at            timestamptz,
  campaigns_influenced  jsonb NOT NULL DEFAULT '[]'::jsonb,
  result_note           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seo_teachings_ws_status
  ON public.growthmind_seo_teachings (workspace_id, status, teaching_type);
ALTER TABLE public.growthmind_seo_teachings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='seo_teachings_members'
      AND polrelid='public.growthmind_seo_teachings'::regclass) THEN
    CREATE POLICY seo_teachings_members ON public.growthmind_seo_teachings
      FOR ALL TO authenticated
      USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
      WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
  END IF;
END $$;
REVOKE ALL ON public.growthmind_seo_teachings FROM anon;

-- ── growthmind_seo_deployment_packages ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_seo_deployment_packages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL,
  campaign_id         uuid,
  content_project_id  uuid,
  work_order_id       uuid,
  status              text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','awaiting_deployment_approval','approved','awaiting_website_deployment','deployed','verified','rolled_back','cancelled')),
  target_website      text,
  page_mode           text CHECK (page_mode IN ('new_page','existing_page')),
  proposed_route      text,
  package             jsonb NOT NULL DEFAULT '{}'::jsonb,
  rollback_content    jsonb,
  validation          jsonb,
  approvals           jsonb NOT NULL DEFAULT '[]'::jsonb,
  manual_instructions text,
  live_url            text,
  verified_at         timestamptz,
  version             integer NOT NULL DEFAULT 1,
  created_by_user_id  uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seo_deploy_pkgs_ws_status
  ON public.growthmind_seo_deployment_packages (workspace_id, status, updated_at DESC);
ALTER TABLE public.growthmind_seo_deployment_packages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='seo_deploy_pkgs_members'
      AND polrelid='public.growthmind_seo_deployment_packages'::regclass) THEN
    CREATE POLICY seo_deploy_pkgs_members ON public.growthmind_seo_deployment_packages
      FOR ALL TO authenticated
      USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
      WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
  END IF;
END $$;
REVOKE ALL ON public.growthmind_seo_deployment_packages FROM anon;
