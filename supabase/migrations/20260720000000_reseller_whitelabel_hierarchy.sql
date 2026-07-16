-- Reseller & White Label hierarchy (Task: parent/child client workspaces).
-- Additive + idempotent. Writes are SERVER-ONLY (service_role): RLS is enabled
-- with SELECT-only policies for workspace members.

-- ── 1. Parent/child workspace links ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_relationships (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  child_workspace_id  UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  relationship_type   TEXT NOT NULL DEFAULT 'reseller_client',
  status              TEXT NOT NULL DEFAULT 'active', -- active | suspended | terminated
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workspace_relationships_no_self CHECK (parent_workspace_id <> child_workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_ws_relationships_parent ON workspace_relationships (parent_workspace_id);

ALTER TABLE workspace_relationships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_relationships_member_read ON workspace_relationships;
CREATE POLICY ws_relationships_member_read ON workspace_relationships
  FOR SELECT TO authenticated
  USING (
    parent_workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
    OR child_workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );
REVOKE INSERT, UPDATE, DELETE ON workspace_relationships FROM authenticated, anon;

-- ── 2. Per-workspace white label settings ───────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_white_label_settings (
  workspace_id          UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_name            TEXT,
  logo_url              TEXT,
  favicon_url           TEXT,
  primary_color         TEXT,
  secondary_color       TEXT,
  accent_color          TEXT,
  support_email         TEXT,
  custom_domain         TEXT,
  custom_domain_status  TEXT NOT NULL DEFAULT 'none', -- none | requested | pending_dns | active
  email_from_name       TEXT,
  email_branding_mode   TEXT NOT NULL DEFAULT 'webee', -- webee | custom
  hide_webee_branding   BOOLEAN NOT NULL DEFAULT FALSE,
  reseller_mode         BOOLEAN NOT NULL DEFAULT FALSE,
  child_branding_mode   TEXT NOT NULL DEFAULT 'inherit', -- inherit | custom | webee
  updated_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE workspace_white_label_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_wl_settings_member_read ON workspace_white_label_settings;
CREATE POLICY ws_wl_settings_member_read ON workspace_white_label_settings
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON workspace_white_label_settings FROM authenticated, anon;

-- ── 3. Reseller client account records ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS reseller_client_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  child_workspace_id  UUID UNIQUE REFERENCES workspaces(id) ON DELETE SET NULL,
  client_name         TEXT NOT NULL,
  client_email        TEXT NOT NULL,
  package_key         TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'invited', -- invited | active | suspended
  branding_mode       TEXT NOT NULL DEFAULT 'inherit', -- inherit | webee | custom
  billing_mode        TEXT NOT NULL DEFAULT 'reseller_billed', -- reseller_billed | direct (billing integration pending)
  upgrade_requested_package_key TEXT,
  upgrade_requested_at TIMESTAMPTZ,
  notes               TEXT,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reseller_clients_parent ON reseller_client_accounts (parent_workspace_id);

ALTER TABLE reseller_client_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reseller_clients_parent_read ON reseller_client_accounts;
CREATE POLICY reseller_clients_parent_read ON reseller_client_accounts
  FOR SELECT TO authenticated
  USING (parent_workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON reseller_client_accounts FROM authenticated, anon;
