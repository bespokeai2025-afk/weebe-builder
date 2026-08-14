-- Personal (per-user) notification preferences.
-- Workspace notification settings stay workspace-wide; this table lets an
-- individual user mute specific non-critical events for themselves.
-- Additive + idempotent.

CREATE TABLE IF NOT EXISTS public.workspace_user_notification_prefs (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  muted_event_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE public.workspace_user_notification_prefs ENABLE ROW LEVEL SECURITY;

-- Per-USER access: a member reads/writes only their own row in workspaces
-- they belong to.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'workspace_user_notification_prefs' AND policyname = 'own_prefs_select'
  ) THEN
    CREATE POLICY own_prefs_select ON public.workspace_user_notification_prefs
      FOR SELECT TO authenticated
      USING (
        user_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM public.workspace_members m
          WHERE m.workspace_id = workspace_user_notification_prefs.workspace_id
            AND m.user_id = auth.uid()
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'workspace_user_notification_prefs' AND policyname = 'own_prefs_insert'
  ) THEN
    CREATE POLICY own_prefs_insert ON public.workspace_user_notification_prefs
      FOR INSERT TO authenticated
      WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM public.workspace_members m
          WHERE m.workspace_id = workspace_user_notification_prefs.workspace_id
            AND m.user_id = auth.uid()
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'workspace_user_notification_prefs' AND policyname = 'own_prefs_update'
  ) THEN
    CREATE POLICY own_prefs_update ON public.workspace_user_notification_prefs
      FOR UPDATE TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;
