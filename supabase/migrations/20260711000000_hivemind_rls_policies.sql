-- HiveMind tables were created (20260622000000 / 20260622000001) with RLS enabled
-- but no policies, so every authenticated read/write silently returned nothing:
-- the action centre never showed pending approvals and approve/reject failed.
-- Add the standard workspace-members policy (same pattern as workspace_workflows).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'hivemind_actions_workspace_members'
      AND polrelid = 'public.hivemind_actions'::regclass
  ) THEN
    CREATE POLICY hivemind_actions_workspace_members ON public.hivemind_actions
      FOR ALL TO authenticated
      USING (workspace_id IN (
        SELECT workspace_members.workspace_id FROM workspace_members
        WHERE workspace_members.user_id = auth.uid()))
      WITH CHECK (workspace_id IN (
        SELECT workspace_members.workspace_id FROM workspace_members
        WHERE workspace_members.user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'hivemind_tasks_workspace_members'
      AND polrelid = 'public.hivemind_tasks'::regclass
  ) THEN
    CREATE POLICY hivemind_tasks_workspace_members ON public.hivemind_tasks
      FOR ALL TO authenticated
      USING (workspace_id IN (
        SELECT workspace_members.workspace_id FROM workspace_members
        WHERE workspace_members.user_id = auth.uid()))
      WITH CHECK (workspace_id IN (
        SELECT workspace_members.workspace_id FROM workspace_members
        WHERE workspace_members.user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'hivemind_events_workspace_members'
      AND polrelid = 'public.hivemind_events'::regclass
  ) THEN
    CREATE POLICY hivemind_events_workspace_members ON public.hivemind_events
      FOR ALL TO authenticated
      USING (workspace_id IN (
        SELECT workspace_members.workspace_id FROM workspace_members
        WHERE workspace_members.user_id = auth.uid()))
      WITH CHECK (workspace_id IN (
        SELECT workspace_members.workspace_id FROM workspace_members
        WHERE workspace_members.user_id = auth.uid()));
  END IF;
END $$;
