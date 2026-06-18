-- WeeBespoke AI Enterprise integration tables
-- Run in Supabase SQL Editor: Dashboard → SQL Editor → New query → Run

-- 1. Enterprise integration credentials/status (one row per integration per workspace)
CREATE TABLE IF NOT EXISTS enterprise_integrations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  client_name      text NOT NULL,
  integration_key  text NOT NULL,
  access_token     text,
  refresh_token    text,
  user_payload     jsonb,
  status           text NOT NULL DEFAULT 'disconnected',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_key, client_name)
);

CREATE INDEX IF NOT EXISTS enterprise_integrations_key_idx
  ON enterprise_integrations (integration_key, client_name);

-- RLS: only platform admins (service_role) via supabaseAdmin can touch this table.
-- Regular client sessions never touch it.
ALTER TABLE enterprise_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_enterprise_integrations"
  ON enterprise_integrations
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 2. Enterprise data cache (isolated from all other platform tables)
CREATE TABLE IF NOT EXISTS webespoke_enterprise_cache (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  client_name  text NOT NULL DEFAULT 'Webuyanyhouse',
  data_type    text NOT NULL,   -- cars | buyers | dealers | bikes | spare_parts
  external_id  text,
  payload      jsonb NOT NULL,
  synced_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webespoke_cache_type_client_idx
  ON webespoke_enterprise_cache (client_name, data_type);

CREATE INDEX IF NOT EXISTS webespoke_cache_external_id_idx
  ON webespoke_enterprise_cache (client_name, data_type, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE webespoke_enterprise_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_webespoke_cache"
  ON webespoke_enterprise_cache
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Auto-update updated_at on enterprise_integrations
CREATE OR REPLACE FUNCTION update_enterprise_integrations_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS enterprise_integrations_updated_at ON enterprise_integrations;
CREATE TRIGGER enterprise_integrations_updated_at
  BEFORE UPDATE ON enterprise_integrations
  FOR EACH ROW EXECUTE FUNCTION update_enterprise_integrations_updated_at();
