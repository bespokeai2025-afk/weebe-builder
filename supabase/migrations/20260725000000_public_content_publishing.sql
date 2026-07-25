-- Public Content Publishing Backbone (master programme continuation)
-- Sites, authoritative publishable items, immutable versions, preview tokens,
-- publication executions, GSC first-data notification dedup.
-- Additive + idempotent. Apply manually via Supabase Management API.

-- ── 1. Public sites (site_key registry; global uniqueness prevents another
--       workspace from publishing to webespokeai.com) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_public_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  site_key text NOT NULL UNIQUE,
  display_name text,
  canonical_host text NOT NULL,
  allowed_origins text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Authoritative publishable content items ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_public_content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.growthmind_public_sites(id) ON DELETE CASCADE,
  content_studio_project_id uuid,
  seo_campaign_id uuid,
  deployment_package_id uuid,
  work_order_id uuid,
  task_id uuid,
  execution_id uuid,
  content_approval_id uuid,
  publication_approval_id uuid,
  content_type text NOT NULL DEFAULT 'blog_post',
  title text NOT NULL DEFAULT '',
  slug text NOT NULL,
  excerpt text,
  body_format text NOT NULL DEFAULT 'markdown' CHECK (body_format IN ('markdown','html','structured')),
  article_body text,
  rendered_body text,
  meta_title text,
  meta_description text,
  canonical_url text,
  og_title text,
  og_description text,
  og_image_url text,
  featured_image_url text,
  featured_image_alt text,
  author_name text,
  reviewer_name text,
  category text,
  tags text[] NOT NULL DEFAULT '{}',
  target_product text,
  target_service text,
  target_audience text,
  target_country text,
  target_language text,
  primary_topic text,
  query_cluster jsonb NOT NULL DEFAULT '[]'::jsonb,
  internal_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  external_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  structured_data jsonb,
  cta jsonb,
  noindex boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','awaiting_brief_approval','awaiting_content_approval',
    'awaiting_publication_approval','scheduled','publishing','api_published',
    'awaiting_website_refresh','live','live_verification_failed','updating',
    'withdrawn','blocked','failed'
  )),
  scheduled_for timestamptz,
  scheduled_timezone text,
  published_at timestamptz,
  withdrawn_at timestamptz,
  current_version integer NOT NULL DEFAULT 0,
  published_version integer,
  previous_version integer,
  safety_gate_result jsonb,
  live_url text,
  live_verification_state text NOT NULL DEFAULT 'not_checked' CHECK (live_verification_state IN (
    'not_checked','awaiting_lovable_frontend','verifying','verified','failed'
  )),
  sitemap_state text NOT NULL DEFAULT 'not_in_sitemap' CHECK (sitemap_state IN (
    'not_in_sitemap','eligible','included','awaiting_sitemap'
  )),
  gsc_monitoring_state text NOT NULL DEFAULT 'not_monitoring' CHECK (gsc_monitoring_state IN (
    'not_monitoring','submitted','discovered','indexed','monitoring'
  )),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_gpci_ws_status ON public.growthmind_public_content_items (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_gpci_site_status_pub ON public.growthmind_public_content_items (site_id, status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_gpci_scheduled ON public.growthmind_public_content_items (status, scheduled_for) WHERE status = 'scheduled';

-- ── 3. Immutable versions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_public_content_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.growthmind_public_content_items(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  version_number integer NOT NULL,
  snapshot jsonb NOT NULL,
  change_summary text,
  changed_by text,
  approval_id uuid,
  publication_execution_id uuid,
  approved boolean NOT NULL DEFAULT false,
  is_published_version boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_gpcv_item ON public.growthmind_public_content_versions (item_id, version_number DESC);

-- ── 4. Preview tokens (hash only; server-only table) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_content_preview_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  site_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES public.growthmind_public_content_items(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gcpt_hash ON public.growthmind_content_preview_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_gcpt_item ON public.growthmind_content_preview_tokens (item_id);

-- ── 5. Publication executions (audit + retry/dead-letter) ────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_publication_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES public.growthmind_public_content_items(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('publish','scheduled_publish','update','withdraw','restore','rollback')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled','dead_letter')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  next_attempt_at timestamptz,
  scheduled_for timestamptz,
  requested_by text,
  approval_id uuid,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_gpe_item ON public.growthmind_publication_executions (item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gpe_due ON public.growthmind_publication_executions (status, next_attempt_at) WHERE status IN ('pending','running');

-- ── 6. GSC first-data notification dedup ─────────────────────────────────────
ALTER TABLE public.growthmind_gsc_sync_state
  ADD COLUMN IF NOT EXISTS first_data_notified_at timestamptz;

-- ── RLS: members read; ALL writes server-only (service_role) ─────────────────
ALTER TABLE public.growthmind_public_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growthmind_public_content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growthmind_public_content_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growthmind_content_preview_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growthmind_publication_executions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'growthmind_public_sites' AND policyname = 'members_read_public_sites') THEN
    CREATE POLICY members_read_public_sites ON public.growthmind_public_sites FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = growthmind_public_sites.workspace_id AND m.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'growthmind_public_content_items' AND policyname = 'members_read_public_content') THEN
    CREATE POLICY members_read_public_content ON public.growthmind_public_content_items FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = growthmind_public_content_items.workspace_id AND m.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'growthmind_public_content_versions' AND policyname = 'members_read_content_versions') THEN
    CREATE POLICY members_read_content_versions ON public.growthmind_public_content_versions FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = growthmind_public_content_versions.workspace_id AND m.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'growthmind_publication_executions' AND policyname = 'members_read_pub_executions') THEN
    CREATE POLICY members_read_pub_executions ON public.growthmind_publication_executions FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = growthmind_publication_executions.workspace_id AND m.user_id = auth.uid()));
  END IF;
  -- preview tokens: NO authenticated policies at all (server-only table)
END $$;

-- Server-write-only: strip default authenticated write grants
REVOKE INSERT, UPDATE, DELETE ON public.growthmind_public_sites FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.growthmind_public_content_items FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.growthmind_public_content_versions FROM authenticated, anon;
REVOKE ALL ON public.growthmind_content_preview_tokens FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.growthmind_publication_executions FROM authenticated, anon;

-- ── Seed the webespokeai site for the WEBEE admin workspace ──────────────────
INSERT INTO public.growthmind_public_sites (workspace_id, site_key, display_name, canonical_host, allowed_origins)
SELECT 'c13db1d5-22e4-44ad-b678-6f296c31a947', 'webespokeai', 'WeBespoke AI', 'www.webespokeai.com',
       ARRAY['https://webespokeai.com','https://www.webespokeai.com']
WHERE NOT EXISTS (SELECT 1 FROM public.growthmind_public_sites WHERE site_key = 'webespokeai');
