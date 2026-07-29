-- ════════════════════════════════════════════════════════════════════════════
-- VEO 3.1 VIDEO PIPELINE — durable generation job records + cost approval gate
-- Apply manually in the Supabase SQL Editor (idempotent, additive-only).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.growthmind_video_jobs (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           UUID NOT NULL,
  user_id                UUID,
  campaign_id            UUID,
  asset_id               UUID,

  -- Planning output (the creative package produced by the planning stage)
  plan                   JSONB,                       -- concept/script/hook/scenes/voiceover/onScreenText/direction
  prompt                 TEXT NOT NULL DEFAULT '',    -- final Veo prompt actually submitted
  prompt_version         INTEGER NOT NULL DEFAULT 1,  -- bumped every time the prompt is adjusted
  brand_context          JSONB,                       -- Business DNA snapshot shown to the user pre-approval

  -- Render settings
  provider               TEXT NOT NULL DEFAULT 'google_veo',
  model                  TEXT NOT NULL DEFAULT '',    -- veo-3.1-generate-preview | veo-3.1-fast-generate-preview
  quality_tier           TEXT NOT NULL DEFAULT 'premium' CHECK (quality_tier IN ('premium','draft')),
  generation_type        TEXT NOT NULL DEFAULT 'text_to_video' CHECK (generation_type IN ('text_to_video','image_to_video','frame_guidance')),
  aspect_ratio           TEXT NOT NULL DEFAULT '16:9',
  resolution             TEXT NOT NULL DEFAULT '720p',
  duration_seconds       INTEGER NOT NULL DEFAULT 8,
  generate_audio         BOOLEAN NOT NULL DEFAULT TRUE,
  variations             INTEGER NOT NULL DEFAULT 1,
  reference_image_url    TEXT,
  last_frame_image_url   TEXT,

  -- Lifecycle
  status                 TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
                           'planning','planned','awaiting_approval','approved',
                           'submitting','rendering','archiving','ready','failed','cancelled')),
  failure_reason         TEXT,
  provider_operation_id  TEXT,
  output_url             TEXT,
  output_storage_path    TEXT,

  -- Cost + approval gate
  estimated_cost_usd     NUMERIC(10,4) NOT NULL DEFAULT 0,
  actual_cost_usd        NUMERIC(10,4),
  approval_required      BOOLEAN NOT NULL DEFAULT TRUE,
  approved_by            UUID,
  approved_at            TIMESTAMPTZ,
  approval_consumed_at   TIMESTAMPTZ,                 -- set atomically when the paid render is submitted

  -- Poller CAS claim
  claimed_at             TIMESTAMPTZ,
  poll_count             INTEGER NOT NULL DEFAULT 0,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at           TIMESTAMPTZ,
  completed_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gm_video_jobs_ws_created
  ON public.growthmind_video_jobs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_video_jobs_rendering
  ON public.growthmind_video_jobs (status)
  WHERE status IN ('rendering','archiving');

ALTER TABLE public.growthmind_video_jobs ENABLE ROW LEVEL SECURITY;

-- Server-write-only: revoke default grants, members may read their workspace rows.
REVOKE ALL ON public.growthmind_video_jobs FROM anon, authenticated;
GRANT SELECT ON public.growthmind_video_jobs TO authenticated;

DO $$ BEGIN
  CREATE POLICY "gm_video_jobs_select" ON public.growthmind_video_jobs
    FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
