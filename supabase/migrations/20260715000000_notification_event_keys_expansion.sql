-- Task #371: Notification preferences expansion — widen the event_key check
-- constraint on workspace_notification_settings to include the new events.
-- Additive/idempotent; safe to re-run.

alter table public.workspace_notification_settings
  drop constraint if exists workspace_notification_settings_event_key_check;

alter table public.workspace_notification_settings
  add constraint workspace_notification_settings_event_key_check check (event_key in (
    'launched','activated','paused','completed','failed','safety_blocked',
    'no_eligible_leads','daily_cap_hit','safety_cap_hit','provider_error',
    'workflow_error','kpi_report_ready','high_negative_sentiment',
    'high_positive_performance','qualified_leads_generated',
    'appointments_booked','follow_up_tasks_created','needs_admin_attention',
    'staff_invite_accepted','systemmind_fix_suggested',
    'reseller_client_created','email_provider_failing'
  ));
