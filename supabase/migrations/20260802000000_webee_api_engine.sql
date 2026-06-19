-- WEBEE API Engine Migration
-- Run in Supabase SQL Editor: Dashboard → SQL Editor → New query → Run
--
-- Creates:
--   workspace_api_profiles  — per-workspace profile linking a data_source to module→endpoint mappings
--   api_engine_logs         — per-call execution log for health monitoring and HiveMind scanner

-- ── workspace_api_profiles ─────────────────────────────────────────────────────
-- One row per workspace+data_source pairing.
-- module_mappings: { "leads": "<endpoint_mapping_id>", "contacts": "<endpoint_mapping_id>", … }
-- engine_config:   arbitrary override config (timeout_ms, retry_count, rate_limit_rps, etc.)

CREATE TABLE IF NOT EXISTS workspace_api_profiles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  data_source_key      text NOT NULL,
  display_name         text NOT NULL,
  connection_id        uuid REFERENCES client_api_connections(id) ON DELETE SET NULL,
  module_mappings      jsonb NOT NULL DEFAULT '{}',
  auth_strategy        text NOT NULL DEFAULT 'bearer_token',
  pagination_strategy  text NOT NULL DEFAULT 'page',
  engine_config        jsonb NOT NULL DEFAULT '{}',
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_api_profiles_ws_source_idx
  ON workspace_api_profiles (workspace_id, data_source_key);

CREATE INDEX IF NOT EXISTS workspace_api_profiles_workspace_id_idx
  ON workspace_api_profiles (workspace_id);

CREATE INDEX IF NOT EXISTS workspace_api_profiles_connection_id_idx
  ON workspace_api_profiles (connection_id);

ALTER TABLE workspace_api_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_admin_manage_workspace_api_profiles"
  ON workspace_api_profiles
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.user_type = 'admin'
    )
  );

CREATE OR REPLACE FUNCTION update_workspace_api_profiles_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_workspace_api_profiles_updated_at ON workspace_api_profiles;
CREATE TRIGGER trg_workspace_api_profiles_updated_at
  BEFORE UPDATE ON workspace_api_profiles
  FOR EACH ROW EXECUTE FUNCTION update_workspace_api_profiles_updated_at();

-- ── api_engine_logs ────────────────────────────────────────────────────────────
-- One row per engine execution (one per module fetch).
-- Used by the HiveMind API Engine scanner to detect anomalies.

CREATE TABLE IF NOT EXISTS api_engine_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_id     uuid REFERENCES workspace_api_profiles(id) ON DELETE SET NULL,
  data_source_key text NOT NULL,
  module_key     text NOT NULL,
  endpoint_path  text NOT NULL,
  http_method    text NOT NULL DEFAULT 'GET',
  status_code    int,
  latency_ms     int,
  record_count   int,
  total_reported int,
  page_fetched   int,
  error_msg      text,
  requested_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_engine_logs_workspace_source_idx
  ON api_engine_logs (workspace_id, data_source_key, requested_at DESC);

CREATE INDEX IF NOT EXISTS api_engine_logs_workspace_module_idx
  ON api_engine_logs (workspace_id, module_key, requested_at DESC);

CREATE INDEX IF NOT EXISTS api_engine_logs_profile_idx
  ON api_engine_logs (profile_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS api_engine_logs_requested_at_idx
  ON api_engine_logs (requested_at DESC);

ALTER TABLE api_engine_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_admin_read_api_engine_logs"
  ON api_engine_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.user_type = 'admin'
    )
  );

-- No INSERT/UPDATE/DELETE for authenticated — all writes via service_role only.
