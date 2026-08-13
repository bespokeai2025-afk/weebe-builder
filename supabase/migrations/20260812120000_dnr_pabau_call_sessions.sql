-- In-call booking context for DNR Retell → Pabau tools (survives server restarts / multi-instance).

CREATE TABLE IF NOT EXISTS public.dnr_pabau_call_sessions (
  workspace_id    UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  retell_call_id  TEXT        NOT NULL DEFAULT '',
  session         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, retell_call_id)
);

CREATE INDEX IF NOT EXISTS dnr_pabau_call_sessions_ws_updated
  ON public.dnr_pabau_call_sessions (workspace_id, updated_at DESC);

ALTER TABLE public.dnr_pabau_call_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dnr_pabau_call_sessions_select" ON public.dnr_pabau_call_sessions;
CREATE POLICY "dnr_pabau_call_sessions_select" ON public.dnr_pabau_call_sessions
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

GRANT SELECT ON public.dnr_pabau_call_sessions TO authenticated;
GRANT ALL ON public.dnr_pabau_call_sessions TO service_role;
