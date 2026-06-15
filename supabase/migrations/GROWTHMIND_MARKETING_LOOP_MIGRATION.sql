-- GrowthMind Marketing Loop Completion Migration
-- Apply in Supabase SQL Editor
-- Phases 1, 4, 7: Campaign linking + variant tracking + performance table

-- ── Phase 1: Campaign ↔ Video linking ─────────────────────────────────────────

ALTER TABLE growthmind_video_assets
  ADD COLUMN IF NOT EXISTS campaign_id     uuid,
  ADD COLUMN IF NOT EXISTS variant_group_id uuid,
  ADD COLUMN IF NOT EXISTS variant_type    text,
  ADD COLUMN IF NOT EXISTS creative_score  jsonb;

CREATE INDEX IF NOT EXISTS growthmind_video_assets_campaign_idx
  ON growthmind_video_assets(workspace_id, campaign_id)
  WHERE campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS growthmind_video_assets_variant_idx
  ON growthmind_video_assets(workspace_id, variant_group_id)
  WHERE variant_group_id IS NOT NULL;

-- ── Phase 7: Video performance tracking ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS growthmind_video_performance (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  video_asset_id   uuid NOT NULL REFERENCES growthmind_video_assets(id) ON DELETE CASCADE,
  campaign_id      uuid,
  platform         text NOT NULL DEFAULT 'meta',
  views            integer NOT NULL DEFAULT 0,
  clicks           integer NOT NULL DEFAULT 0,
  ctr_pct          numeric(6,4),
  watch_time_avg_s numeric(8,2),
  leads            integer NOT NULL DEFAULT 0,
  appointments     integer NOT NULL DEFAULT 0,
  cost_gbp         numeric(10,2),
  revenue_gbp      numeric(10,2),
  roas             numeric(8,4),
  notes            text,
  recorded_at      date NOT NULL DEFAULT CURRENT_DATE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS growthmind_video_perf_asset_idx
  ON growthmind_video_performance(workspace_id, video_asset_id);

CREATE INDEX IF NOT EXISTS growthmind_video_perf_campaign_idx
  ON growthmind_video_performance(workspace_id, campaign_id)
  WHERE campaign_id IS NOT NULL;

ALTER TABLE growthmind_video_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage video performance"
  ON growthmind_video_performance FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
