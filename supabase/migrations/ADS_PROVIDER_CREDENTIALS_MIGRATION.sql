-- ──────────────────────────────────────────────────────────────────────────────
-- Ads Provider Credentials — Budget Caps + Schema Fixes
-- Apply in Supabase SQL Editor: https://app.supabase.com → SQL Editor
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. growthmind_ad_campaigns — direct campaign rows without account_id FK
--    Upserted per workspace/platform/campaign on every 15-min sync tick.
CREATE TABLE IF NOT EXISTS growthmind_ad_campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  platform      TEXT NOT NULL,          -- meta | google | tiktok
  external_id   TEXT NOT NULL,          -- platform-native campaign ID
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  spend         NUMERIC(12,2) NOT NULL DEFAULT 0,
  impressions   BIGINT NOT NULL DEFAULT 0,
  clicks        BIGINT NOT NULL DEFAULT 0,
  conversions   NUMERIC(12,4) NOT NULL DEFAULT 0,
  revenue       NUMERIC(12,2) NOT NULL DEFAULT 0,
  roas          NUMERIC(8,4),
  date_start    DATE,
  date_end      DATE,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, platform, external_id, date_start)
);

CREATE INDEX IF NOT EXISTS idx_gm_ad_campaigns_ws
  ON growthmind_ad_campaigns (workspace_id);
CREATE INDEX IF NOT EXISTS idx_gm_ad_campaigns_platform
  ON growthmind_ad_campaigns (workspace_id, platform);
CREATE INDEX IF NOT EXISTS idx_gm_ad_campaigns_synced
  ON growthmind_ad_campaigns (workspace_id, synced_at DESC);

-- 2. growthmind_ad_sync_log — log every sync attempt per workspace/platform.
--    account_id is nullable so the new sync engine (no ads_accounts rows needed)
--    can insert rows directly using only workspace_id + platform.
CREATE TABLE IF NOT EXISTS growthmind_ad_sync_log (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL,
  account_id         UUID,              -- nullable; FK only when account row exists
  platform           TEXT NOT NULL,
  campaigns_synced   INTEGER NOT NULL DEFAULT 0,
  spend_total        NUMERIC(12,2)     DEFAULT 0,
  impressions_total  BIGINT            DEFAULT 0,
  clicks_total       BIGINT            DEFAULT 0,
  conversions_total  NUMERIC(12,4)     DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'success',
  error_message      TEXT,
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Make account_id nullable on existing installs (migration may have created it NOT NULL)
ALTER TABLE growthmind_ad_sync_log
  ALTER COLUMN account_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gm_ad_sync_log_ws
  ON growthmind_ad_sync_log (workspace_id);
CREATE INDEX IF NOT EXISTS idx_gm_ad_sync_log_platform
  ON growthmind_ad_sync_log (workspace_id, platform);

-- 3. growthmind_ad_budget_alerts — make account_id nullable too
CREATE TABLE IF NOT EXISTS growthmind_ad_budget_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  account_id    UUID,                   -- nullable
  platform      TEXT NOT NULL,
  alert_type    TEXT NOT NULL,
  threshold     NUMERIC(12,2),
  current_value NUMERIC(12,2),
  message       TEXT,
  acknowledged  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE growthmind_ad_budget_alerts
  ALTER COLUMN account_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gm_ad_alerts_ws
  ON growthmind_ad_budget_alerts (workspace_id);
CREATE INDEX IF NOT EXISTS idx_gm_ad_alerts_unack
  ON growthmind_ad_budget_alerts (workspace_id, acknowledged)
  WHERE acknowledged = FALSE;

-- 4. growthmind_ad_budget_caps — configurable per-workspace monthly budget caps.
--    UI: GrowthMind → Ads Performance → Budget Alert Thresholds section.
--    Sync engine reads this to generate budget_80pct / budget_exceeded alerts.
CREATE TABLE IF NOT EXISTS growthmind_ad_budget_caps (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL,
  platform            TEXT NOT NULL,       -- meta | google | tiktok
  monthly_budget_cap  NUMERIC(12,2),       -- NULL = no cap configured
  alert_at_pct        NUMERIC(5,2) NOT NULL DEFAULT 80,  -- e.g. 80 = alert at 80%
  currency            TEXT NOT NULL DEFAULT 'GBP',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_gm_ad_budget_caps_ws
  ON growthmind_ad_budget_caps (workspace_id);

-- 5. workspace_settings — add Meta Ads mirror columns if missing
ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS meta_ads_access_token TEXT,
  ADD COLUMN IF NOT EXISTS meta_ads_account_id   TEXT;
