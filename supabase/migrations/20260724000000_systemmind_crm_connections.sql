-- Task #457: SystemMind CRM integration engine
-- Per-workspace CRM connection rows (encrypted credentials, server-only) +
-- persisted discovery snapshots. Both tables are SERVER-ONLY: RLS enabled with
-- zero policies AND explicit REVOKE, so authenticated/anon can never read the
-- encrypted credential payloads. All access goes through server functions
-- which mask secrets.

CREATE TABLE IF NOT EXISTS systemmind_crm_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  provider text NOT NULL,
  label text NOT NULL DEFAULT '',
  credentials_encrypted text NOT NULL DEFAULT '',
  credential_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'unverified',
  last_test_report jsonb,
  last_tested_at timestamptz,
  token_expires_at timestamptz,
  last_refreshed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT systemmind_crm_connections_status_check
    CHECK (status IN ('unverified','connected','failed')),
  CONSTRAINT systemmind_crm_connections_provider_check
    CHECK (provider IN ('hubspot','salesforce','pipedrive','gohighlevel','dynamics','zoho','pabau','webee','generic_rest','webhook'))
);

CREATE UNIQUE INDEX IF NOT EXISTS systemmind_crm_connections_ws_provider_label_uniq
  ON systemmind_crm_connections (workspace_id, provider, label);
CREATE INDEX IF NOT EXISTS systemmind_crm_connections_ws_idx
  ON systemmind_crm_connections (workspace_id);

CREATE TABLE IF NOT EXISTS systemmind_crm_discoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES systemmind_crm_connections(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  provider text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  object_count integer NOT NULL DEFAULT 0,
  field_count integer NOT NULL DEFAULT 0,
  pipeline_count integer NOT NULL DEFAULT 0,
  owner_count integer NOT NULL DEFAULT 0,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  discovered_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS systemmind_crm_discoveries_connection_uniq
  ON systemmind_crm_discoveries (connection_id);
CREATE INDEX IF NOT EXISTS systemmind_crm_discoveries_ws_idx
  ON systemmind_crm_discoveries (workspace_id);

ALTER TABLE systemmind_crm_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE systemmind_crm_discoveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON systemmind_crm_connections FROM authenticated, anon;
REVOKE ALL ON systemmind_crm_discoveries FROM authenticated, anon;
