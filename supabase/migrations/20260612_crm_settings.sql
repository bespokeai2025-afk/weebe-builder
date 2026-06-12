-- Add CRM integration fields to workspace_settings
ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS hubspot_api_key text,
  ADD COLUMN IF NOT EXISTS ghl_api_key text,
  ADD COLUMN IF NOT EXISTS ghl_location_id text;
