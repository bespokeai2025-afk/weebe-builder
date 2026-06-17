-- ── Image Studio Migration ────────────────────────────────────────────────────
-- Creates growthmind_image_assets table and extends content_calendar.
-- Apply in Supabase SQL Editor.

-- ── 1. Image Assets ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS growthmind_image_assets (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id          UUID        NULL REFERENCES growthmind_campaign_drafts(id) ON DELETE SET NULL,
  strategy_id          UUID        NULL,
  content_asset_id     UUID        NULL,
  provider             TEXT        NOT NULL DEFAULT 'gpt_image',
  prompt               TEXT        NOT NULL DEFAULT '',
  revised_prompt       TEXT        NULL,
  image_url            TEXT        NOT NULL DEFAULT '',
  thumbnail_url        TEXT        NULL,
  status               TEXT        NOT NULL DEFAULT 'ready'
                                   CHECK (status IN ('generating','ready','failed','deleted')),
  error_message        TEXT        NULL,
  knowledge_context_type TEXT      NOT NULL DEFAULT 'default',
  knowledge_context_id   UUID      NULL,
  business_name        TEXT        NULL,
  asset_type           TEXT        NOT NULL DEFAULT 'ad_creative'
                                   CHECK (asset_type IN (
                                     'ad_creative','social_image','product_image',
                                     'blog_image','hero_image','variation','edit'
                                   )),
  platform_hint        TEXT        NOT NULL DEFAULT 'generic'
                                   CHECK (platform_hint IN (
                                     'meta','instagram','linkedin','tiktok','google','generic'
                                   )),
  width                INTEGER     NULL,
  height               INTEGER     NULL,
  style                TEXT        NULL,
  parent_asset_id      UUID        NULL REFERENCES growthmind_image_assets(id) ON DELETE SET NULL,
  cost_usd             NUMERIC(10,6) NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gm_image_assets_ws
  ON growthmind_image_assets (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_image_assets_campaign
  ON growthmind_image_assets (campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gm_image_assets_type
  ON growthmind_image_assets (workspace_id, asset_type);
CREATE INDEX IF NOT EXISTS idx_gm_image_assets_platform
  ON growthmind_image_assets (workspace_id, platform_hint);
CREATE INDEX IF NOT EXISTS idx_gm_image_assets_status
  ON growthmind_image_assets (workspace_id, status);

ALTER TABLE growthmind_image_assets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "gm_image_assets_all" ON growthmind_image_assets FOR ALL
    USING (workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Extend content calendar with image link ─────────────────────────────────

ALTER TABLE growthmind_content_calendar
  ADD COLUMN IF NOT EXISTS image_asset_id UUID NULL
    REFERENCES growthmind_image_assets(id) ON DELETE SET NULL;

-- ── Done ──────────────────────────────────────────────────────────────────────
