-- Lead auto-call automation: mirrors the lead_auto_email_* pattern.
-- When enabled, a brand-new lead automatically gets an outbound qualification
-- call placed via the configured agent (see src/lib/qualification/auto-call.server.ts).

ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS lead_auto_call_enabled   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lead_auto_call_agent_id  UUID REFERENCES public.agents(id) ON DELETE SET NULL;
