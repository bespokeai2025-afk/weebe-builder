-- Add Meta WhatsApp Business API fields to workspace_settings
ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS meta_phone_number_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_waba_id          TEXT,
  ADD COLUMN IF NOT EXISTS meta_access_token     TEXT,
  ADD COLUMN IF NOT EXISTS meta_verify_token     TEXT;
