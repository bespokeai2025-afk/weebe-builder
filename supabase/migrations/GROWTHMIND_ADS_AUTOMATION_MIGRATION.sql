-- ──────────────────────────────────────────────────────────────────────────────
-- GrowthMind Ads Automation — Live Sync, Webhooks & Ad Spend Monitoring
-- Apply in Supabase SQL Editor: https://app.supabase.com → SQL Editor
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Extend growthmind_ads_accounts with sync fields
ALTER TABLE growthmind_ads_accounts
  ADD COLUMN IF NOT EXISTS last_synced_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sync_status          TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS sync_error           TEXT,
  ADD COLUMN IF NOT EXISTS meta_pixel_id        TEXT,
  ADD COLUMN IF NOT EXISTS meta_app_id          TEXT,
  ADD COLUMN IF NOT EXISTS meta_app_secret_enc  TEXT,
  ADD COLUMN IF NOT EXISTS webhook_registered   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS webhook_id           TEXT,
  ADD COLUMN IF NOT EXISTS currency             TEXT NOT NULL DEFAULT 'GBP',
  ADD COLUMN IF NOT EXISTS monthly_budget       NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS total_spend_synced   NUMERIC(12,2) DEFAULT 0;

-- 2. Ad sync log — one row per sync attempt per account
CREATE TABLE IF NOT EXISTS growthmind_ad_sync_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  account_id    UUID NOT NULL REFERENCES growthmind_ads_accounts(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'success',  -- success | error | partial
  campaigns_synced INTEGER NOT NULL DEFAULT 0,
  spend_total   NUMERIC(12,2) DEFAULT 0,
  error_message TEXT,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Ad webhook events — incoming events from Meta/TikTok
CREATE TABLE IF NOT EXISTS growthmind_ad_webhook_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID,
  platform      TEXT NOT NULL,
  account_id    UUID REFERENCES growthmind_ads_accounts(id) ON DELETE SET NULL,
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}',
  processed     BOOLEAN NOT NULL DEFAULT FALSE,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Ad budget alerts
CREATE TABLE IF NOT EXISTS growthmind_ad_budget_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  account_id    UUID REFERENCES growthmind_ads_accounts(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,
  alert_type    TEXT NOT NULL,  -- budget_80pct | budget_exceeded | cpl_spike | roas_drop | zero_spend
  threshold     NUMERIC(12,2),
  current_value NUMERIC(12,2),
  message       TEXT,
  acknowledged  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ad_sync_log_workspace  ON growthmind_ad_sync_log(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ad_sync_log_account    ON growthmind_ad_sync_log(account_id);
CREATE INDEX IF NOT EXISTS idx_ad_webhook_events_ws   ON growthmind_ad_webhook_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ad_webhook_events_plat ON growthmind_ad_webhook_events(platform);
CREATE INDEX IF NOT EXISTS idx_ad_budget_alerts_ws    ON growthmind_ad_budget_alerts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ad_budget_alerts_ack   ON growthmind_ad_budget_alerts(workspace_id, acknowledged);
