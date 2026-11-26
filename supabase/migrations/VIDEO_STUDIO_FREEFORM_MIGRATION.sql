-- Video Studio Free-Form Prompt upgrade
-- Apply in Supabase SQL Editor (safe to re-run — all IF NOT EXISTS)

ALTER TABLE growthmind_video_assets
  ADD COLUMN IF NOT EXISTS original_prompt  TEXT,
  ADD COLUMN IF NOT EXISTS optimized_prompt TEXT,
  ADD COLUMN IF NOT EXISTS generation_mode  TEXT DEFAULT 'guided',
  ADD COLUMN IF NOT EXISTS platform         TEXT,
  ADD COLUMN IF NOT EXISTS aspect_ratio     TEXT DEFAULT '16:9',
  ADD COLUMN IF NOT EXISTS quality_checks   JSONB;

COMMENT ON COLUMN growthmind_video_assets.original_prompt  IS 'Raw user free-form prompt before optimisation';
COMMENT ON COLUMN growthmind_video_assets.optimized_prompt IS 'GrowthMind-optimised Veo generation prompt';
COMMENT ON COLUMN growthmind_video_assets.generation_mode  IS 'guided | freeform';
COMMENT ON COLUMN growthmind_video_assets.platform         IS 'meta | tiktok | linkedin | youtube | instagram | general';
COMMENT ON COLUMN growthmind_video_assets.aspect_ratio     IS '16:9 | 9:16 | 1:1 | 4:5';
COMMENT ON COLUMN growthmind_video_assets.quality_checks   IS 'JSON array of {rule, passed, note} quality check results';
