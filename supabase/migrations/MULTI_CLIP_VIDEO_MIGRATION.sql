-- Multi-Clip Video Assembly Migration
-- Extends growthmind_video_assets with composite/assembly fields,
-- and creates growthmind_video_clips to track per-scene Veo jobs.
--
-- Run this in Supabase SQL Editor.

-- ── Extend growthmind_video_assets ───────────────────────────────────────────

ALTER TABLE growthmind_video_assets
  ADD COLUMN IF NOT EXISTS is_composite              boolean      DEFAULT false,
  ADD COLUMN IF NOT EXISTS final_video_url           text,
  ADD COLUMN IF NOT EXISTS assembly_status           text,
  ADD COLUMN IF NOT EXISTS assembly_error            text,
  ADD COLUMN IF NOT EXISTS requested_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS actual_duration_seconds   integer;

-- ── Create growthmind_video_clips ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS growthmind_video_clips (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid        NOT NULL,
  asset_id           uuid        NOT NULL REFERENCES growthmind_video_assets(id) ON DELETE CASCADE,
  scene_index        integer     NOT NULL,
  scene_title        text,
  scene_prompt       text,
  duration_seconds   integer,
  provider           text,
  provider_job_id    text,
  status             text        NOT NULL DEFAULT 'pending',
  raw_video_url      text,
  archived_video_url text,
  error_message      text,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS growthmind_video_clips_asset_id_idx
  ON growthmind_video_clips(asset_id);
CREATE INDEX IF NOT EXISTS growthmind_video_clips_workspace_id_idx
  ON growthmind_video_clips(workspace_id);
CREATE INDEX IF NOT EXISTS growthmind_video_clips_status_idx
  ON growthmind_video_clips(status);

-- ── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE growthmind_video_clips ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'growthmind_video_clips'
      AND policyname = 'workspace members can manage video clips'
  ) THEN
    CREATE POLICY "workspace members can manage video clips"
      ON growthmind_video_clips
      FOR ALL
      USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members
          WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;
