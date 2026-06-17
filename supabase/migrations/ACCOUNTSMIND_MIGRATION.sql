-- ============================================================
-- ACCOUNTSMIND CLIENT COSTING + PROFIT MONITORING
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- 1. client_billing_profiles — per-workspace monthly charge config
CREATE TABLE IF NOT EXISTS client_billing_profiles (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  monthly_charge_cents     INTEGER NOT NULL DEFAULT 0,
  currency                 TEXT NOT NULL DEFAULT 'GBP',
  billing_cycle            TEXT NOT NULL DEFAULT 'monthly',
  included_minutes         INTEGER NOT NULL DEFAULT 0,
  included_messages        INTEGER NOT NULL DEFAULT 0,
  included_video_seconds   INTEGER NOT NULL DEFAULT 0,
  included_email_sends     INTEGER NOT NULL DEFAULT 0,
  included_storage_mb      INTEGER NOT NULL DEFAULT 0,
  overage_rates_json       JSONB NOT NULL DEFAULT '{}',
  contract_start_date      DATE,
  contract_end_date        DATE,
  status                   TEXT NOT NULL DEFAULT 'active',
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id)
);

-- 2. client_monthly_costs — pre-computed monthly cost snapshots per workspace
CREATE TABLE IF NOT EXISTS client_monthly_costs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  month                    DATE NOT NULL,
  monthly_charge_cents     INTEGER NOT NULL DEFAULT 0,
  total_cost_cents         INTEGER NOT NULL DEFAULT 0,
  voice_cost_cents         INTEGER NOT NULL DEFAULT 0,
  llm_cost_cents           INTEGER NOT NULL DEFAULT 0,
  telephony_cost_cents     INTEGER NOT NULL DEFAULT 0,
  whatsapp_cost_cents      INTEGER NOT NULL DEFAULT 0,
  email_cost_cents         INTEGER NOT NULL DEFAULT 0,
  video_cost_cents         INTEGER NOT NULL DEFAULT 0,
  image_cost_cents         INTEGER NOT NULL DEFAULT 0,
  storage_cost_cents       INTEGER NOT NULL DEFAULT 0,
  infrastructure_cost_cents INTEGER NOT NULL DEFAULT 0,
  gross_profit_cents       INTEGER NOT NULL DEFAULT 0,
  gross_margin_percent     NUMERIC(6,2) NOT NULL DEFAULT 0,
  source_breakdown_json    JSONB NOT NULL DEFAULT '{}',
  computed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, month)
);

-- 3. provider_recharge_events — platform-level and workspace-level recharge tracking
CREATE TABLE IF NOT EXISTS provider_recharge_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_category TEXT NOT NULL,
  provider_name     TEXT NOT NULL,
  workspace_id      UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  amount_cents      INTEGER NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'GBP',
  event_type        TEXT NOT NULL DEFAULT 'manual',
  description       TEXT,
  source            TEXT NOT NULL DEFAULT 'manual',
  detected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload       JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. accountsmind_alerts — margin/cost/usage alerts
CREATE TABLE IF NOT EXISTS accountsmind_alerts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  alert_type          TEXT NOT NULL,
  severity            TEXT NOT NULL DEFAULT 'info',
  title               TEXT NOT NULL,
  message             TEXT NOT NULL,
  provider_category   TEXT,
  provider_name       TEXT,
  amount_cents        INTEGER,
  status              TEXT NOT NULL DEFAULT 'open',
  hivemind_action_id  UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at         TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_client_billing_profiles_workspace ON client_billing_profiles(workspace_id);
CREATE INDEX IF NOT EXISTS idx_client_monthly_costs_workspace    ON client_monthly_costs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_client_monthly_costs_month        ON client_monthly_costs(month DESC);
CREATE INDEX IF NOT EXISTS idx_provider_recharge_events_detected ON provider_recharge_events(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_accountsmind_alerts_workspace     ON accountsmind_alerts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_accountsmind_alerts_status        ON accountsmind_alerts(status);
CREATE INDEX IF NOT EXISTS idx_accountsmind_alerts_severity      ON accountsmind_alerts(severity);

-- RLS policies
ALTER TABLE client_billing_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_monthly_costs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_recharge_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE accountsmind_alerts       ENABLE ROW LEVEL SECURITY;

-- Admin-only SELECT (service role bypasses RLS automatically)
CREATE POLICY "admin_select_billing_profiles"
  ON client_billing_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.user_type = 'admin'
    )
  );

CREATE POLICY "admin_all_billing_profiles"
  ON client_billing_profiles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.user_type = 'admin'
    )
  );

CREATE POLICY "admin_all_monthly_costs"
  ON client_monthly_costs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.user_type = 'admin'
    )
  );

CREATE POLICY "admin_all_recharge_events"
  ON provider_recharge_events FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.user_type = 'admin'
    )
  );

CREATE POLICY "admin_all_accountsmind_alerts"
  ON accountsmind_alerts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.user_type = 'admin'
    )
  );

-- Workspace users can see their own billing summary (read-only)
CREATE POLICY "workspace_select_own_billing"
  ON client_billing_profiles FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
    OR workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "workspace_select_own_monthly_costs"
  ON client_monthly_costs FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
    OR workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "workspace_select_own_alerts"
  ON accountsmind_alerts FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
    OR workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()
    )
  );
