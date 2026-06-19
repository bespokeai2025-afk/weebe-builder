-- Client API Probe Tables
-- Run in Supabase SQL Editor: Dashboard → SQL Editor → New query → Run
-- Creates two tables for the SystemMind Clients → API Probe feature.
-- Access: admin users only via profiles.user_type check + service_role bypass.

-- ── client_api_connections ────────────────────────────────────────────────────
-- Stores one row per external API (e.g. Webuyanyhouse). Credentials are
-- AES-256-CBC encrypted server-side before write; never returned to the browser.

CREATE TABLE IF NOT EXISTS client_api_connections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             text,
  workspace_id          uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  name                  text NOT NULL,
  base_url              text NOT NULL,
  auth_type             text NOT NULL DEFAULT 'bearer_token',
  -- Credentials stored as { "_enc": "ivHex:cipherHex" } — AES-256-CBC,
  -- key derived from SUPABASE_SERVICE_ROLE_KEY server-side. Never plaintext.
  encrypted_credentials jsonb,
  status                text NOT NULL DEFAULT 'untested',
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_api_connections_client_id_idx
  ON client_api_connections (client_id);

CREATE INDEX IF NOT EXISTS client_api_connections_workspace_id_idx
  ON client_api_connections (workspace_id);

ALTER TABLE client_api_connections ENABLE ROW LEVEL SECURITY;

-- Deny all direct access by authenticated users (no anon read, no user write).
-- All writes go through supabaseAdmin (service_role) which bypasses RLS.
-- Admin users CAN read their own workspace's connection metadata (not credentials —
-- encrypted_credentials is never selected by any client-facing query).
CREATE POLICY "platform_admin_read_client_api_connections"
  ON client_api_connections
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.user_type = 'admin'
    )
  );

-- No INSERT/UPDATE/DELETE policy for authenticated role — all writes via service_role only.

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_client_api_connections_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_client_api_connections_updated_at ON client_api_connections;
CREATE TRIGGER trg_client_api_connections_updated_at
  BEFORE UPDATE ON client_api_connections
  FOR EACH ROW EXECUTE FUNCTION update_client_api_connections_updated_at();

-- ── client_api_endpoint_mappings ──────────────────────────────────────────────
-- Stores one row per (connection, endpoint path) pair, recording how the
-- endpoint maps to a WEBEE module (leads, contacts, calls, etc.).

CREATE TABLE IF NOT EXISTS client_api_endpoint_mappings (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_api_connection_id  uuid NOT NULL REFERENCES client_api_connections(id) ON DELETE CASCADE,
  workspace_id              uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  module_key                text NOT NULL,
  endpoint_path             text NOT NULL,
  method                    text NOT NULL DEFAULT 'GET',
  query_params              jsonb,
  body_template             jsonb,
  detected_array_path       text,
  pagination_strategy       text,
  field_mapping             jsonb,
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_api_endpoint_mappings_connection_idx
  ON client_api_endpoint_mappings (client_api_connection_id);

CREATE INDEX IF NOT EXISTS client_api_endpoint_mappings_workspace_idx
  ON client_api_endpoint_mappings (workspace_id);

ALTER TABLE client_api_endpoint_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_admin_read_client_api_endpoint_mappings"
  ON client_api_endpoint_mappings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.user_type = 'admin'
    )
  );

-- No INSERT/UPDATE/DELETE policy for authenticated role — all writes via service_role only.

CREATE OR REPLACE FUNCTION update_client_api_endpoint_mappings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_client_api_endpoint_mappings_updated_at ON client_api_endpoint_mappings;
CREATE TRIGGER trg_client_api_endpoint_mappings_updated_at
  BEFORE UPDATE ON client_api_endpoint_mappings
  FOR EACH ROW EXECUTE FUNCTION update_client_api_endpoint_mappings_updated_at();
