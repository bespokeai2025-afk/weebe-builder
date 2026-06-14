-- Add Google Search Console OAuth columns to workspace_settings
ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS gsc_access_token  TEXT,
  ADD COLUMN IF NOT EXISTS gsc_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS gsc_token_expiry  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gsc_property_url  TEXT;
