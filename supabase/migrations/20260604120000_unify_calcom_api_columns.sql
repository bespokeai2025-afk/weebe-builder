-- Unify calcom_api_key and calcom_api_token into one canonical column.
-- calcom_api_key is the canonical name (used by Settings > Calendar UI and
-- the booking tools path). calcom_api_token was used by the old integrations
-- path. Copy any data from the legacy column and drop it.

UPDATE workspace_settings
  SET calcom_api_key = calcom_api_token
  WHERE calcom_api_key IS NULL
    AND calcom_api_token IS NOT NULL;

ALTER TABLE workspace_settings DROP COLUMN calcom_api_token;
