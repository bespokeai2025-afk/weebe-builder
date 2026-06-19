-- Salesforce and Pipedrive CRM integration columns
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)

ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS salesforce_instance_url  text,
  ADD COLUMN IF NOT EXISTS salesforce_access_token  text,
  ADD COLUMN IF NOT EXISTS pipedrive_api_token       text;

COMMENT ON COLUMN workspace_settings.salesforce_instance_url IS 'Salesforce org instance URL (e.g. https://yourorg.salesforce.com)';
COMMENT ON COLUMN workspace_settings.salesforce_access_token IS 'Salesforce connected-app access token';
COMMENT ON COLUMN workspace_settings.pipedrive_api_token      IS 'Pipedrive personal API token';
