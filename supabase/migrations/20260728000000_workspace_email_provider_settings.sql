-- Task #370: Workspace email provider architecture (WEBEE Resend default + custom)
-- One row per workspace. Credentials are AES-encrypted server-side and NEVER
-- readable by clients: RLS is enabled with ZERO policies and all direct grants
-- revoked, so every read/write goes through server code (service role) only.

CREATE TABLE IF NOT EXISTS workspace_email_provider_settings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL DEFAULT 'resend',
  sending_mode          TEXT NOT NULL DEFAULT 'platform_default'
                        CHECK (sending_mode IN ('platform_default', 'custom')),
  from_name             TEXT,
  from_email            TEXT,
  reply_to_email        TEXT,
  encrypted_config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  domain_status         TEXT NOT NULL DEFAULT 'unverified'
                        CHECK (domain_status IN ('unverified', 'pending', 'verified')),
  is_active             BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_to_platform  BOOLEAN NOT NULL DEFAULT TRUE,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  last_send_status      TEXT,
  last_send_at          TIMESTAMPTZ,
  last_send_error       TEXT,
  last_send_provider    TEXT,
  created_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wep_settings_ws ON workspace_email_provider_settings (workspace_id);

ALTER TABLE workspace_email_provider_settings ENABLE ROW LEVEL SECURITY;
-- Server-only table: zero policies (deny-all under RLS) + revoke default grants.
REVOKE ALL ON workspace_email_provider_settings FROM authenticated;
REVOKE ALL ON workspace_email_provider_settings FROM anon;
