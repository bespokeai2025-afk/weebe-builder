-- VEO AUDIO FIX MIGRATION
-- Adds has_audio column to growthmind_video_assets to track native Veo 3 audio.
--
-- Apply this in the Supabase SQL Editor:
--   https://supabase.com/dashboard/project/<your-project>/sql
--
-- SAFE TO RUN MULTIPLE TIMES (idempotent via IF NOT EXISTS).

ALTER TABLE growthmind_video_assets
  ADD COLUMN IF NOT EXISTS has_audio BOOLEAN;

COMMENT ON COLUMN growthmind_video_assets.has_audio IS
  'True when Veo 3+ native audio generation was requested at generation time. '
  'NULL = generated before this column was added (pre-audit). '
  'Veo 3 on Gemini Developer API always bakes audio into the MP4 regardless of this flag.';
