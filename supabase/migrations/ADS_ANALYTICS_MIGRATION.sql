-- ──────────────────────────────────────────────────────────────────────────────
-- Ads Analytics Migration — campaign metrics sync, performance log, budget alerts
-- Apply in Supabase SQL Editor: https://app.supabase.com → SQL Editor
-- Safe to re-run (all IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Extend growthmind_campaigns with sync tracking columns
ALTER TABLE growthmind_campaigns
  ADD COLUMN IF NOT EXISTS external_id    TEXT,          -- platform campaign ID
  ADD COLUMN IF NOT EXISTS synced_at      TIMESTAMPTZ,   -- last pulled from API
  ADD COLUMN IF NOT EXISTS revenue        NUMERIC(12,2), -- total conversion value
  ADD COLUMN IF NOT EXISTS date_start     DATE,
  ADD COLUMN IF NOT EXISTS date_end       DATE;

-- Unique constraint for upsert: one row per workspace+platform+external campaign id per period
CREATE UNIQUE INDEX IF NOT EXISTS idx_growthmind_campaigns_upsert
  ON growthmind_campaigns (workspace_id, platform, external_id, date_start)
  WHERE external_id IS NOT NULL;

-- 2. Ad sync log — records every sync attempt per workspace+platform
--    (growthmind_ad_sync_log is the canonical name; growthmind_ad_performance_log is an alias view)
CREATE TABLE IF NOT EXISTS growthmind_ad_sync_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID        NOT NULL,
  platform         TEXT        NOT NULL,  -- google | meta
  campaigns_synced INTEGER     NOT NULL DEFAULT 0,
  spend_total      NUMERIC(12,2),
  impressions_total BIGINT,
  clicks_total     BIGINT,
  conversions_total BIGINT,
  status           TEXT        NOT NULL DEFAULT 'success', -- success | error | partial
  error_message    TEXT,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_sync_log_ws   ON growthmind_ad_sync_log (workspace_id);
CREATE INDEX IF NOT EXISTS idx_ad_sync_log_ts   ON growthmind_ad_sync_log (workspace_id, synced_at DESC);

-- Alias table for backward compat with code that uses growthmind_ad_performance_log
CREATE TABLE IF NOT EXISTS growthmind_ad_performance_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID        NOT NULL,
  platform         TEXT        NOT NULL,
  campaigns_synced INTEGER     NOT NULL DEFAULT 0,
  spend_total      NUMERIC(12,2),
  impressions_total BIGINT,
  clicks_total     BIGINT,
  conversions_total BIGINT,
  status           TEXT        NOT NULL DEFAULT 'success',
  error_message    TEXT,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_perf_log_ws   ON growthmind_ad_performance_log (workspace_id);
CREATE INDEX IF NOT EXISTS idx_ad_perf_log_ts   ON growthmind_ad_performance_log (workspace_id, synced_at DESC);

-- 3. Budget alerts (standalone — no FK deps)
CREATE TABLE IF NOT EXISTS growthmind_ad_budget_alerts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL,
  platform      TEXT        NOT NULL,
  alert_type    TEXT        NOT NULL,  -- budget_80pct | budget_exceeded | roas_drop | zero_spend | high_cpl
  current_value NUMERIC(12,2),
  threshold     NUMERIC(12,2),
  message       TEXT,
  acknowledged  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_budget_alerts_ws  ON growthmind_ad_budget_alerts (workspace_id);
CREATE INDEX IF NOT EXISTS idx_ad_budget_alerts_ack ON growthmind_ad_budget_alerts (workspace_id, acknowledged);

-- 4. Budget caps — user-configured monthly spend limits per workspace+platform
--    Used by the sync engine to generate budget_80pct and budget_exceeded alerts.
CREATE TABLE IF NOT EXISTS growthmind_ad_budget_caps (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID        NOT NULL,
  platform            TEXT        NOT NULL,  -- google | meta
  monthly_budget_cap  NUMERIC(12,2) NOT NULL, -- configured monthly budget in GBP/USD
  alert_at_pct        INTEGER     NOT NULL DEFAULT 80,  -- alert when spend % of monthly cap
  currency            TEXT        NOT NULL DEFAULT 'GBP',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_ad_budget_caps_ws ON growthmind_ad_budget_caps (workspace_id);

-- 5. Webhook events — records incoming platform webhook notifications
CREATE TABLE IF NOT EXISTS growthmind_ad_webhook_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID,
  platform      TEXT        NOT NULL,  -- google | meta
  event_type    TEXT,                  -- campaign_status_change | budget_alert | sync_complete
  payload       JSONB,
  processed     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_webhook_events_ws  ON growthmind_ad_webhook_events (workspace_id);
CREATE INDEX IF NOT EXISTS idx_ad_webhook_events_ts  ON growthmind_ad_webhook_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_webhook_events_prc ON growthmind_ad_webhook_events (processed);
