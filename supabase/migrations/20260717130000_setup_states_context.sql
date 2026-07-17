-- SystemMind Setup Console — Required Context layer.
-- One jsonb column holds all context groups (business/agent/data/crm/trigger/
-- outcome/booking/followup/compliance/success) plus completeness + confirm meta.
-- No secrets ever stored here (assertNoCredentialValues on every write).
SET lock_timeout = '8s';

ALTER TABLE public.systemmind_setup_states
  ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}'::jsonb;
