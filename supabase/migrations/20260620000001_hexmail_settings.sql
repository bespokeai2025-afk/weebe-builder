-- Add HexMail email-provider settings to workspace_settings
ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS hexmail_active_provider        TEXT,
  ADD COLUMN IF NOT EXISTS hexmail_sendgrid_api_key       TEXT,
  ADD COLUMN IF NOT EXISTS hexmail_sendgrid_from_email    TEXT,
  ADD COLUMN IF NOT EXISTS hexmail_sendgrid_from_name     TEXT,
  ADD COLUMN IF NOT EXISTS hexmail_resend_api_key         TEXT,
  ADD COLUMN IF NOT EXISTS hexmail_resend_from_email      TEXT,
  ADD COLUMN IF NOT EXISTS hexmail_resend_from_name       TEXT,
  ADD COLUMN IF NOT EXISTS hexmail_postmark_server_token  TEXT,
  ADD COLUMN IF NOT EXISTS hexmail_postmark_from_email    TEXT,
  ADD COLUMN IF NOT EXISTS hexmail_postmark_from_name     TEXT;
