-- Lead email send history (compose, template send, and automated sends) +
-- per-workspace automation config for "auto-email leads who prefer email".

CREATE TABLE IF NOT EXISTS public.lead_email_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id      UUID        NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  template_id  UUID        NULL,
  trigger      TEXT        NOT NULL DEFAULT 'manual_compose', -- manual_compose | manual_template | auto_new_lead
  provider     TEXT        NULL,
  to_email     TEXT        NOT NULL,
  subject      TEXT        NULL,
  status       TEXT        NOT NULL DEFAULT 'sent', -- sent | failed
  message_id   TEXT        NULL,
  error        TEXT        NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS lead_email_log_lookup_idx
  ON public.lead_email_log(workspace_id, lead_id, created_at DESC);

-- Idempotency guard: at most one *successful* automated send per lead.
CREATE UNIQUE INDEX IF NOT EXISTS lead_email_log_auto_once_idx
  ON public.lead_email_log(lead_id)
  WHERE trigger = 'auto_new_lead' AND status = 'sent';

ALTER TABLE public.lead_email_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_email_log_workspace_member" ON public.lead_email_log;
CREATE POLICY "lead_email_log_workspace_member" ON public.lead_email_log
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_email_log TO authenticated;
GRANT ALL ON public.lead_email_log TO service_role;

-- Per-workspace automation config: auto-send a HexMail template when a new
-- lead's preferred contact method is email.
ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS lead_auto_email_enabled     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS lead_auto_email_template_id UUID NULL;
