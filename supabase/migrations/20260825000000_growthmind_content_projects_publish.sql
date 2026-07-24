-- ── GrowthMind Phase 4: Content Studio handoff, approval workflow & publishing ─
-- 1. growthmind_content_projects — the real studio project created from an
--    approved adaptation recommendation ("Create in Content Studio" handoff).
--    Bidirectional links: project.recommendation_id + growthmind_content_links
--    (studio_kind 'content_studio', studio_ref_id = project id).
-- 2. growthmind_publishing_jobs — idempotency + retry columns for the Meta
--    reels/feed publishing service.
--
-- Writes are SERVER-ONLY (service role); authenticated members get SELECT via
-- the standard workspace_members RLS pattern.

-- ── 1. growthmind_content_projects ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growthmind_content_projects (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID NOT NULL,
  recommendation_id    UUID,                              -- growthmind_content_recommendations.id
  trend_item_id        UUID,                              -- growthmind_trend_items.id
  anatomy_id           UUID,                              -- growthmind_content_anatomy.id
  asset_id             UUID,                              -- growthmind_content_assets.id (optional text asset)
  title                TEXT NOT NULL,
  format               TEXT NOT NULL DEFAULT 'reel',      -- reel | image_post | carousel | story | other
  target_platform      TEXT NOT NULL DEFAULT 'instagram', -- instagram | facebook | multi
  script               TEXT,
  scene_timeline       JSONB NOT NULL DEFAULT '[]'::jsonb,
  voiceover_script     TEXT,
  subtitles            TEXT,
  caption              TEXT,
  cta                  TEXT,
  thumbnail_text       TEXT,
  hashtags             JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_assets      JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{kind, description, fulfilled, asset_ref}]
  brand_kit            JSONB NOT NULL DEFAULT '{}'::jsonb, -- colours, fonts, logo refs
  inspiration          JSONB NOT NULL DEFAULT '{}'::jsonb, -- source refs (url, platform, author, anatomy)
  target_connection_id UUID,                               -- growthmind_social_connections.id
  recommended_time     TEXT,
  -- Production media (real assets preferred; AI media must be labelled)
  media_url            TEXT,
  media_type           TEXT,                               -- video | image
  media_source         TEXT,                               -- workspace_asset | uploaded | video_studio | image_studio | ai_generated | stock
  media_is_ai          BOOLEAN NOT NULL DEFAULT FALSE,
  thumbnail_url        TEXT,
  voiceover_url        TEXT,
  voiceover_is_ai      BOOLEAN NOT NULL DEFAULT FALSE,
  -- Approval workflow
  status               TEXT NOT NULL DEFAULT 'in_production'
                       CHECK (status IN (
                         'in_production','awaiting_assets','awaiting_approval','changes_requested',
                         'approved','scheduled','publishing','published','failed','archived')),
  status_history       JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{from,to,at,by,note}]
  approval_flags       JSONB NOT NULL DEFAULT '[]'::jsonb, -- rule hits: claims | pricing | ai_spokesperson…
  approved_version     JSONB,                              -- frozen snapshot at approval time
  approved_at          TIMESTAMPTZ,
  approved_by          TEXT,
  approval_action_id   UUID,                               -- hivemind_actions.id routing the approval
  created_by           TEXT NOT NULL DEFAULT 'user',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gm_content_projects_ws
  ON public.growthmind_content_projects (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_content_projects_rec
  ON public.growthmind_content_projects (recommendation_id);
ALTER TABLE public.growthmind_content_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gm_content_projects_members" ON public.growthmind_content_projects;
CREATE POLICY "gm_content_projects_members" ON public.growthmind_content_projects
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.growthmind_content_projects FROM authenticated, anon;
GRANT SELECT ON public.growthmind_content_projects TO authenticated;

-- ── 2. growthmind_publishing_jobs — idempotency & retry columns ───────────────
ALTER TABLE public.growthmind_publishing_jobs
  ADD COLUMN IF NOT EXISTS project_id         UUID,
  ADD COLUMN IF NOT EXISTS idempotency_key    TEXT,
  ADD COLUMN IF NOT EXISTS next_attempt_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_attempts       INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS attempt_history    JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_error_code    TEXT,
  ADD COLUMN IF NOT EXISTS guidance           TEXT,
  ADD COLUMN IF NOT EXISTS external_permalink TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_pub_jobs_idem
  ON public.growthmind_publishing_jobs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gm_pub_jobs_due
  ON public.growthmind_publishing_jobs (status, next_attempt_at)
  WHERE status IN ('scheduled','publishing');
CREATE INDEX IF NOT EXISTS idx_gm_pub_jobs_project
  ON public.growthmind_publishing_jobs (project_id);
