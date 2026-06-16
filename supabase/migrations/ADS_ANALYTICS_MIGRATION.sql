-- ──────────────────────────────────────────────────────────────────────────────
-- Ads Analytics Migration — campaign metrics sync, performance log, budget alerts
-- Apply in Supabase SQL Editor: https://app.supabase.com → SQL Editor
-- Safe to re-run (all IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Dedicated ads campaign metrics table — separate from growthmind_campaigns
--    (growthmind_campaigns is a legacy planner table; ads sync uses this table)
CREATE TABLE IF NOT EXISTS growthmind_ad_campaigns (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID          NOT NULL,
  platform      TEXT          NOT NULL,  -- meta | google
  external_id   TEXT          NOT NULL,  -- platform-assigned campaign ID
  name          TEXT          NOT NULL,
  status        TEXT          NOT NULL DEFAULT 'active',
  spend         NUMERIC(12,2) NOT NULL DEFAULT 0,
  impressions   BIGINT        NOT NULL DEFAULT 0,
  clicks        BIGINT        NOT NULL DEFAULT 0,
  conversions   BIGINT        NOT NULL DEFAULT 0,
  revenue       NUMERIC(12,2) NOT NULL DEFAULT 0,
  roas          NUMERIC(8,4),
  date_start    DATE,
  date_end      DATE,
  synced_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, platform, external_id, date_start)
);

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_ws     ON growthmind_ad_campaigns (workspace_id);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_plat   ON growthmind_ad_campaigns (workspace_id, platform);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_sync   ON growthmind_ad_campaigns (workspace_id, synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_spend  ON growthmind_ad_campaigns (workspace_id, spend DESC);

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
