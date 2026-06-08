-- Timestamped notes attached to any entity: lead, contact, or call.
-- Notes are workspace-scoped and ordered newest-first by default.

CREATE TABLE IF NOT EXISTS public.entity_notes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type  TEXT        NOT NULL,
  entity_id    UUID        NOT NULL,
  body         TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS entity_notes_lookup_idx
  ON public.entity_notes(workspace_id, entity_type, entity_id, created_at DESC);

ALTER TABLE public.entity_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "entity_notes_workspace_member" ON public.entity_notes;
CREATE POLICY "entity_notes_workspace_member" ON public.entity_notes
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.entity_notes TO authenticated;
GRANT ALL ON public.entity_notes TO service_role;
