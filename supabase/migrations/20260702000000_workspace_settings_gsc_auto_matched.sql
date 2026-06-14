-- Track whether the GSC property was auto-matched from the site URL after OAuth
ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS gsc_auto_matched BOOLEAN DEFAULT FALSE;
