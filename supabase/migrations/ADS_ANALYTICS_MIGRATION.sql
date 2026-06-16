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

-- 2. Standalone ad performance log (no FK to growthmind_ads_accounts so it works
--    in workspaces that haven't run the older ads automation migration)
CREATE TABLE IF NOT EXISTS growthmind_ad_performance_log (
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
