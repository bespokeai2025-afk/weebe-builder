-- Lead notification filters: optional per-event filter config evaluated
-- server-side before delivery of lead-category notifications.
-- Additive only.
alter table public.workspace_notification_settings
  add column if not exists lead_filter jsonb;
