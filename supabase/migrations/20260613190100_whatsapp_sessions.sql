-- WhatsApp conversation sessions (for Runtime Phase 3)
CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_phone   TEXT NOT NULL,
  agent_id        UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  current_node_id TEXT,
  context         JSONB DEFAULT '{}',
  message_count   INT  DEFAULT 0,
  ended           BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, contact_phone)
);
CREATE INDEX IF NOT EXISTS wa_sessions_ws_idx ON public.whatsapp_sessions(workspace_id);
CREATE INDEX IF NOT EXISTS wa_sessions_phone_idx ON public.whatsapp_sessions(workspace_id, contact_phone);

ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_sessions_members" ON public.whatsapp_sessions
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_sessions TO authenticated;
GRANT ALL ON public.whatsapp_sessions TO service_role;
