-- Provider Usage Log: time-series event log for 30-day rolling stats
-- Each call to trackProviderUsage inserts one row here in addition to
-- updating the running-total aggregate in provider_usage.
-- Apply in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS provider_usage_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_category TEXT NOT NULL,
  provider_name     TEXT NOT NULL,
  requests          INT NOT NULL DEFAULT 1,
  errors            INT NOT NULL DEFAULT 0,
  cost_usd          NUMERIC(18,6) NOT NULL DEFAULT 0,
  duration_ms       INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Efficient look-up by workspace + provider + time range (used by 30-day agg)
CREATE INDEX IF NOT EXISTS idx_provider_usage_log_ws_ts
  ON provider_usage_log (workspace_id, provider_category, provider_name, created_at DESC);

-- Auto-partition cleanup: keep only 90 days to avoid unbounded growth
-- (optional — can be run manually or via pg_cron)
-- DELETE FROM provider_usage_log WHERE created_at < NOW() - INTERVAL '90 days';

ALTER TABLE provider_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can read usage log"
  ON provider_usage_log FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
