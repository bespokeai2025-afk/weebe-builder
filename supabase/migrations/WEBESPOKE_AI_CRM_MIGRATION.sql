-- WeeBespoke AI CRM integration columns
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)

ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS webespoke_api_key  text,
  ADD COLUMN IF NOT EXISTS webespoke_api_url   text;

COMMENT ON COLUMN workspace_settings.webespoke_api_key  IS 'WeeBespoke AI API key for this workspace';
COMMENT ON COLUMN workspace_settings.webespoke_api_url   IS 'WeeBespoke AI base URL for this workspace (e.g. https://app.webespokeai.com)';
