-- Human sales agents & lead assignment (Task: sales agents, lead assignment,
-- assignment notifications).
--
-- 1. leads.assigned_to — canonical human assignee. Dashboard code already
--    filters on this column for assignedRecordsOnly roles but no migration
--    ever defined it (verified missing in the live schema on 2026-08-13).
-- 2. lead_assignment_audit — full audit trail for assign/reassign/unassign.
--    Server-write-only (service_role); workspace members may read.
--
-- Additive + idempotent — safe to re-run.

-- workspace_members.role is a Postgres enum — the new built-in role must be
-- added or sales-agent invites/memberships fail at the DB level.
ALTER TYPE public.workspace_role ADD VALUE IF NOT EXISTS 'sales_agent';

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS assigned_to uuid;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS assigned_by uuid;

CREATE INDEX IF NOT EXISTS idx_leads_ws_assigned_to
  ON public.leads (workspace_id, assigned_to)
  WHERE assigned_to IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.lead_assignment_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  assigned_to uuid,           -- NULL = unassigned
  previous_assigned_to uuid,  -- NULL = was unassigned
  assigned_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_assignment_audit_ws_lead
  ON public.lead_assignment_audit (workspace_id, lead_id, created_at DESC);

ALTER TABLE public.lead_assignment_audit ENABLE ROW LEVEL SECURITY;

-- Members may read the audit trail; ALL writes go through service_role
-- server functions (no INSERT/UPDATE/DELETE policies for authenticated).
DROP POLICY IF EXISTS "lead_assignment_audit_members_read" ON public.lead_assignment_audit;
CREATE POLICY "lead_assignment_audit_members_read"
  ON public.lead_assignment_audit FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM public.workspace_members wm
      WHERE wm.user_id = auth.uid()
    )
  );

-- Default grants give authenticated ALL — strip writes explicitly.
REVOKE INSERT, UPDATE, DELETE ON public.lead_assignment_audit FROM authenticated;
REVOKE ALL ON public.lead_assignment_audit FROM anon;
