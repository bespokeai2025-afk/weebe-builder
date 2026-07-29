-- SAFETY GATE VIDEO MIGRATION
-- Adds safety_blocked and safety_evidence columns to growthmind_video_assets
-- so the universal content safety gate result is persisted alongside each video asset.
--
-- Apply this in the Supabase SQL Editor:
--   https://supabase.com/dashboard/project/<your-project>/sql
--
-- SAFE TO RUN MULTIPLE TIMES (idempotent via IF NOT EXISTS).

ALTER TABLE growthmind_video_assets
  ADD COLUMN IF NOT EXISTS safety_blocked BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE growthmind_video_assets
  ADD COLUMN IF NOT EXISTS safety_evidence JSONB;

COMMENT ON COLUMN growthmind_video_assets.safety_blocked IS
  'True when the universal content safety gate found one or more violations in the '
  'video script at generation time. Blocked assets should not be exported/published '
  'until the violations are resolved and the asset is regenerated.';

COMMENT ON COLUMN growthmind_video_assets.safety_evidence IS
  'Raw evidence item from the content safety gate (source="safety_check"). '
  'Contains passed boolean, violation_count, violations array, warnings array, '
  'claim_classifications, and the gate result ranAt timestamp. '
  'NULL on assets generated before this column was added.';
