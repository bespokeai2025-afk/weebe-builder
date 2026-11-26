-- Canonical notification catalogue extension + event-level dedup ledger.
-- Additive only.

-- ── 1. Extend event_key check constraint with the 14 new catalogue keys ─────
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
    'lead_created','whatsapp_reply_received','marketing_operator_digest',
    -- new canonical catalogue keys (2026-08)
    'lead_positive','lead_assigned','campaign_stalled','report_failed',
    'followup_reply_received','followup_failed',
    'hivemind_alert','hivemind_task_created','hivemind_recommendation',
    'systemmind_workflow_failed','systemmind_integration_error',
    'systemmind_agent_setup_issue',
    'accountsmind_billing_alert','accountsmind_cost_threshold'
  ]));

-- ── 2. Event-level dedup ledger (server-write-only, append-only) ────────────
CREATE TABLE IF NOT EXISTS public.notification_event_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  event_key text NOT NULL,
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, event_key, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_nel_created ON public.notification_event_ledger (created_at);

ALTER TABLE public.notification_event_ledger ENABLE ROW LEVEL SECURITY;
-- No policies: service_role only (deny-all for authenticated/anon by design).
REVOKE ALL ON public.notification_event_ledger FROM authenticated, anon;
