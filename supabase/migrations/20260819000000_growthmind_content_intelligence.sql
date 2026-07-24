-- ─────────────────────────────────────────────────────────────────────────────
-- GrowthMind Content Intelligence — Phase 1 foundations
--
--   growthmind_business_dna          — EXTENDED with structured content-intel
--                                      fields + version counter (not replaced)
--   growthmind_dna_versions          — full JSONB snapshot per saved version
--   growthmind_dna_proposals         — GrowthMind-proposed DNA updates
--                                      (never silently applied)
--   growthmind_social_connections    — Meta (IG professional / FB Page /
--                                      business / ad account) OAuth connections;
--                                      token stored ENCRYPTED and column-denied
--                                      to authenticated (server-only)
--   growthmind_monitored_sources     — user-managed competitor/creator/topic/
--                                      keyword/hashtag/exclusion lists
--   growthmind_trend_items           — discovered trend/content items
--   growthmind_content_recommendations — recommendations & briefs w/ lifecycle
--   growthmind_content_links         — recommendation ↔ Studio project links
--   growthmind_publishing_jobs       — publishing/scheduling jobs
--   growthmind_performance_snapshots — post-publish metric snapshots
--   growthmind_activity_log          — audit/activity for every CI action
--   workspace_settings               — growthmind_mode (+ operator fields,
--                                      limits) mirroring the HiveMind pattern
--
-- Additive + idempotent: safe to re-run. Applied to the SHARED dev/prod
-- Supabase DB via the Management API (scripts/apply-growthmind-content-
-- intelligence-migration.mjs) or the SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 0. workspace_settings: GrowthMind autonomy mode ──────────────────────────
ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS growthmind_mode TEXT NOT NULL DEFAULT 'recommend',
  ADD COLUMN IF NOT EXISTS growthmind_operator_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS growthmind_operator_permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS growthmind_operator_enabled_by UUID,
  ADD COLUMN IF NOT EXISTS growthmind_operator_enabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS growthmind_ci_limits JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_settings_growthmind_mode_check'
  ) THEN
    ALTER TABLE public.workspace_settings
      ADD CONSTRAINT workspace_settings_growthmind_mode_check
      CHECK (growthmind_mode IN ('observe','recommend','assistant','operator'));
  END IF;
END $$;

-- ── 1. growthmind_business_dna: extended structured profile ──────────────────
ALTER TABLE public.growthmind_business_dna
  ADD COLUMN IF NOT EXISTS customer_pain_points   TEXT,
  ADD COLUMN IF NOT EXISTS common_objections      TEXT,
  ADD COLUMN IF NOT EXISTS buying_triggers        TEXT,
  ADD COLUMN IF NOT EXISTS approved_claims        TEXT,
  ADD COLUMN IF NOT EXISTS restricted_claims      TEXT,
  ADD COLUMN IF NOT EXISTS restricted_topics      TEXT,
  ADD COLUMN IF NOT EXISTS preferred_ctas         TEXT,
  ADD COLUMN IF NOT EXISTS content_styles         TEXT,
  ADD COLUMN IF NOT EXISTS priority_topics        TEXT,
  ADD COLUMN IF NOT EXISTS avoid_topics           TEXT,
  ADD COLUMN IF NOT EXISTS proof_points           TEXT,
  ADD COLUMN IF NOT EXISTS brand_assets           JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS approved_voices        TEXT,
  ADD COLUMN IF NOT EXISTS content_objectives     TEXT,
  ADD COLUMN IF NOT EXISTS commercial_objectives  TEXT,
  ADD COLUMN IF NOT EXISTS dna_version            INTEGER NOT NULL DEFAULT 1;

-- ── 2. growthmind_dna_versions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_dna_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL,
  version        INTEGER NOT NULL,
  snapshot       JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_by     TEXT NOT NULL DEFAULT 'user',       -- user | growthmind | system
  changed_by_user_id UUID,
  change_summary TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_dna_versions_ws_v
  ON public.growthmind_dna_versions (workspace_id, version);
ALTER TABLE public.growthmind_dna_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gm_dna_versions_members" ON public.growthmind_dna_versions;
CREATE POLICY "gm_dna_versions_members" ON public.growthmind_dna_versions
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.growthmind_dna_versions FROM authenticated, anon;
GRANT SELECT ON public.growthmind_dna_versions TO authenticated;

-- ── 3. growthmind_dna_proposals ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_dna_proposals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL,
  proposed_by    TEXT NOT NULL DEFAULT 'growthmind', -- growthmind | system
  field_changes  JSONB NOT NULL DEFAULT '{}'::jsonb, -- { field: { current, proposed } }
  rationale      TEXT,
  source         TEXT,                               -- what triggered the proposal
  status         TEXT NOT NULL DEFAULT 'proposed'
                 CHECK (status IN ('proposed','approved','rejected','superseded')),
  resolved_by_user_id UUID,
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gm_dna_proposals_ws
  ON public.growthmind_dna_proposals (workspace_id, status, created_at DESC);
ALTER TABLE public.growthmind_dna_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gm_dna_proposals_members" ON public.growthmind_dna_proposals;
CREATE POLICY "gm_dna_proposals_members" ON public.growthmind_dna_proposals
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.growthmind_dna_proposals FROM authenticated, anon;
GRANT SELECT ON public.growthmind_dna_proposals TO authenticated;

-- ── 4. growthmind_social_connections ──────────────────────────────────────────
-- access_token_encrypted / refresh_token_encrypted are SERVER-ONLY:
-- column-level grants below exclude them for authenticated.
CREATE TABLE IF NOT EXISTS public.growthmind_social_connections (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           UUID NOT NULL,
  provider               TEXT NOT NULL DEFAULT 'meta'
                         CHECK (provider IN ('meta')),
  account_type           TEXT NOT NULL
                         CHECK (account_type IN ('instagram_professional','facebook_page','meta_business','meta_ad_account')),
  external_account_id    TEXT NOT NULL,
  account_name           TEXT,
  username               TEXT,
  profile_picture_url    TEXT,
  permissions            JSONB NOT NULL DEFAULT '[]'::jsonb,   -- granted scopes
  capabilities           JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { publishing, analytics, comments, ... }
  access_token_encrypted TEXT,                                 -- SERVER ONLY (AES-256-GCM)
  token_type             TEXT NOT NULL DEFAULT 'long_lived',
  token_expires_at       TIMESTAMPTZ,
  status                 TEXT NOT NULL DEFAULT 'connected'
                         CHECK (status IN ('connected','needs_reconnect','expired','error','disconnected')),
  last_error             TEXT,
  last_sync_at           TIMESTAMPTZ,
  connected_by_user_id   UUID,
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_social_conn_ws_acct
  ON public.growthmind_social_connections (workspace_id, provider, account_type, external_account_id);
CREATE INDEX IF NOT EXISTS idx_gm_social_conn_ws
  ON public.growthmind_social_connections (workspace_id, status);
ALTER TABLE public.growthmind_social_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gm_social_conn_members" ON public.growthmind_social_connections;
CREATE POLICY "gm_social_conn_members" ON public.growthmind_social_connections
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.growthmind_social_connections FROM authenticated, anon;
GRANT SELECT (
  id, workspace_id, provider, account_type, external_account_id, account_name,
  username, profile_picture_url, permissions, capabilities, token_type,
  token_expires_at, status, last_error, last_sync_at, connected_by_user_id,
  metadata, created_at, updated_at
) ON public.growthmind_social_connections TO authenticated;

-- ── 5. growthmind_monitored_sources ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_monitored_sources (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  source_kind   TEXT NOT NULL
                CHECK (source_kind IN (
                  'competitor_direct','competitor_indirect','industry_creator',
                  'aspirational_brand','customer_account','target_topic',
                  'keyword','hashtag','excluded_account','excluded_topic')),
  platform      TEXT,                                -- instagram | facebook | youtube | tiktok | web | any
  value         TEXT NOT NULL,                       -- handle/url/topic/keyword/hashtag
  label         TEXT,
  priority      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','paused')),
  notes         TEXT,
  added_by_user_id UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_monitored_ws_kind_value
  ON public.growthmind_monitored_sources (workspace_id, source_kind, COALESCE(platform,'any'), lower(value));
CREATE INDEX IF NOT EXISTS idx_gm_monitored_ws
  ON public.growthmind_monitored_sources (workspace_id, source_kind, status, priority DESC);
ALTER TABLE public.growthmind_monitored_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gm_monitored_members" ON public.growthmind_monitored_sources;
CREATE POLICY "gm_monitored_members" ON public.growthmind_monitored_sources
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.growthmind_monitored_sources FROM authenticated, anon;
GRANT SELECT ON public.growthmind_monitored_sources TO authenticated;

-- ── 6. growthmind_trend_items ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_trend_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL,
  source_id      UUID,                               -- growthmind_monitored_sources.id (nullable)
  platform       TEXT NOT NULL,                      -- instagram | facebook | youtube | google_trends | news | reddit | internal | other
  external_id    TEXT,
  url            TEXT,
  title          TEXT,
  caption        TEXT,
  media_type     TEXT,                               -- video | reel | image | carousel | text | audio
  author_handle  TEXT,
  author_name    TEXT,
  published_at   TIMESTAMPTZ,
  metrics        JSONB NOT NULL DEFAULT '{}'::jsonb, -- views/likes/comments/shares/velocity...
  scores         JSONB NOT NULL DEFAULT '{}'::jsonb, -- relevance/momentum/fit/effort/total...
  content_hash   TEXT,                               -- dedupe key
  status         TEXT NOT NULL DEFAULT 'discovered'
                 CHECK (status IN ('discovered','screened','analysed','recommended','dismissed','stale','archived')),
  raw            JSONB NOT NULL DEFAULT '{}'::jsonb,
  discovered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_trend_ws_hash
  ON public.growthmind_trend_items (workspace_id, content_hash)
  WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gm_trend_ws
  ON public.growthmind_trend_items (workspace_id, status, discovered_at DESC);
ALTER TABLE public.growthmind_trend_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gm_trend_members" ON public.growthmind_trend_items;
CREATE POLICY "gm_trend_members" ON public.growthmind_trend_items
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.growthmind_trend_items FROM authenticated, anon;
GRANT SELECT ON public.growthmind_trend_items TO authenticated;

-- ── 7. growthmind_content_recommendations ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_content_recommendations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL,
  trend_item_id  UUID,                               -- growthmind_trend_items.id (nullable)
  title          TEXT NOT NULL,
  brief          TEXT,
  angle          TEXT,
  format         TEXT,                               -- reel | image_post | carousel | story | blog | email | other
  target_platform TEXT,                              -- instagram | facebook | multi
  status         TEXT NOT NULL DEFAULT 'recommended'
                 CHECK (status IN (
                   'discovered','analysed','recommended','drafting','in_content_studio',
                   'awaiting_assets','awaiting_approval','changes_requested','approved',
                   'scheduled','publishing','published','failed','measuring','completed','archived')),
  risk_flags     JSONB NOT NULL DEFAULT '[]'::jsonb, -- e.g. customer_claim, pricing, controversial
  scores         JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb, -- brief details, hooks, script outline…
  created_by     TEXT NOT NULL DEFAULT 'growthmind', -- growthmind | user
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gm_content_recs_ws
  ON public.growthmind_content_recommendations (workspace_id, status, created_at DESC);
ALTER TABLE public.growthmind_content_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gm_content_recs_members" ON public.growthmind_content_recommendations;
CREATE POLICY "gm_content_recs_members" ON public.growthmind_content_recommendations
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.growthmind_content_recommendations FROM authenticated, anon;
GRANT SELECT ON public.growthmind_content_recommendations TO authenticated;

-- ── 8. growthmind_content_links ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_content_links (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL,
  recommendation_id UUID NOT NULL,
  studio_kind       TEXT NOT NULL
                    CHECK (studio_kind IN ('content_studio','image_studio','video_studio','blog_writer','other')),
  studio_ref_id     TEXT NOT NULL,                   -- id of the studio project/draft/job
  status            TEXT NOT NULL DEFAULT 'linked'
                    CHECK (status IN ('linked','in_progress','completed','abandoned')),
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gm_content_links_ws
  ON public.growthmind_content_links (workspace_id, recommendation_id);
ALTER TABLE public.growthmind_content_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gm_content_links_members" ON public.growthmind_content_links;
CREATE POLICY "gm_content_links_members" ON public.growthmind_content_links
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.growthmind_content_links FROM authenticated, anon;
GRANT SELECT ON public.growthmind_content_links TO authenticated;

-- ── 9. growthmind_publishing_jobs ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_publishing_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL,
  connection_id     UUID,                            -- growthmind_social_connections.id
  recommendation_id UUID,
  platform          TEXT NOT NULL,                   -- instagram | facebook
  target_type       TEXT NOT NULL DEFAULT 'feed'
                    CHECK (target_type IN ('feed','reel','story','page_post')),
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb, -- caption, media refs, hashtags…
  validation        JSONB NOT NULL DEFAULT '{}'::jsonb, -- pre-publish check results
  scheduled_at      TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','validating','awaiting_approval','approved','scheduled','publishing','published','failed','cancelled')),
  external_post_id  TEXT,
  error_message     TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0,
  created_by        TEXT NOT NULL DEFAULT 'growthmind',
  approved_by_user_id UUID,
  published_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gm_pub_jobs_ws
  ON public.growthmind_publishing_jobs (workspace_id, status, scheduled_at);
ALTER TABLE public.growthmind_publishing_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gm_pub_jobs_members" ON public.growthmind_publishing_jobs;
CREATE POLICY "gm_pub_jobs_members" ON public.growthmind_publishing_jobs
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.growthmind_publishing_jobs FROM authenticated, anon;
GRANT SELECT ON public.growthmind_publishing_jobs TO authenticated;

-- ── 10. growthmind_performance_snapshots ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_performance_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL,
  publishing_job_id UUID,
  connection_id     UUID,
  external_post_id  TEXT,
  platform          TEXT,
  captured_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metrics           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gm_perf_snap_ws
  ON public.growthmind_performance_snapshots (workspace_id, external_post_id, captured_at DESC);
ALTER TABLE public.growthmind_performance_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gm_perf_snap_members" ON public.growthmind_performance_snapshots;
CREATE POLICY "gm_perf_snap_members" ON public.growthmind_performance_snapshots
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.growthmind_performance_snapshots FROM authenticated, anon;
GRANT SELECT ON public.growthmind_performance_snapshots TO authenticated;

-- ── 11. growthmind_activity_log ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_activity_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  actor        TEXT NOT NULL DEFAULT 'growthmind',   -- growthmind | user | system
  actor_user_id UUID,
  category     TEXT NOT NULL,                        -- dna | social | trends | recommendations | publishing | mode | other
  action       TEXT NOT NULL,                        -- machine-readable verb
  entity_type  TEXT,
  entity_id    TEXT,
  summary      TEXT,
  detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
  mode_at_time TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gm_activity_ws
  ON public.growthmind_activity_log (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_activity_ws_cat
  ON public.growthmind_activity_log (workspace_id, category, created_at DESC);
ALTER TABLE public.growthmind_activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gm_activity_members" ON public.growthmind_activity_log;
CREATE POLICY "gm_activity_members" ON public.growthmind_activity_log
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.growthmind_activity_log FROM authenticated, anon;
GRANT SELECT ON public.growthmind_activity_log TO authenticated;
