-- Audit log for receptionist Pabau / Retell custom tool invocations (DNR and similar).

CREATE TABLE IF NOT EXISTS public.receptionist_tool_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  retell_call_id  TEXT,
  tool_name       TEXT        NOT NULL,
  ok              BOOLEAN     NOT NULL DEFAULT false,
  request_summary JSONB       NOT NULL DEFAULT '{}'::jsonb,
  response_summary JSONB      NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS receptionist_tool_events_ws_recent
  ON public.receptionist_tool_events (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS receptionist_tool_events_call_idx
  ON public.receptionist_tool_events (retell_call_id)
  WHERE retell_call_id IS NOT NULL;

ALTER TABLE public.receptionist_tool_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "receptionist_tool_events_select" ON public.receptionist_tool_events;
CREATE POLICY "receptionist_tool_events_select" ON public.receptionist_tool_events
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

GRANT SELECT ON public.receptionist_tool_events TO authenticated;
GRANT ALL ON public.receptionist_tool_events TO service_role;
