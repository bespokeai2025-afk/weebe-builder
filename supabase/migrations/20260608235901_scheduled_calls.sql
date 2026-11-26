-- Scheduled outbound calls: store the intended fire time + which agent/number to use.
-- Also adds an index so polling for due calls is fast.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS scheduled_call_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_agent_id     UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scheduled_from_number  TEXT;

CREATE INDEX IF NOT EXISTS leads_scheduled_call_at_idx
  ON public.leads(workspace_id, scheduled_call_at)
  WHERE scheduled_call_at IS NOT NULL;
