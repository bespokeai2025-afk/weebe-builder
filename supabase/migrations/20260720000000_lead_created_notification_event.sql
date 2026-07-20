-- Adds the "lead_created" notification event key to the
-- workspace_notification_settings event_key check constraint.
-- Applied to the live database on 2026-07-20 via the Management API.

ALTER TABLE workspace_notification_settings
  DROP CONSTRAINT workspace_notification_settings_event_key_check;

ALTER TABLE workspace_notification_settings
  ADD CONSTRAINT workspace_notification_settings_event_key_check
  CHECK (event_key = ANY (ARRAY[
    'launched','activated','paused','completed','failed','safety_blocked',
    'no_eligible_leads','daily_cap_hit','safety_cap_hit','provider_error',
    'workflow_error','kpi_report_ready','high_negative_sentiment',
    'high_positive_performance','qualified_leads_generated','appointments_booked',
    'follow_up_tasks_created','needs_admin_attention','staff_invite_accepted',
    'systemmind_fix_suggested','reseller_client_created','email_provider_failing',
    'lead_created'
  ]));
