-- ─────────────────────────────────────────────────────────────────────────────
-- Workflow Engine RLS — close the tenant-isolation gap on the two automation tables.
--
-- WORKFLOW_ENGINE_MIGRATION.sql created `workflow_templates` (platform-level, shared)
-- and `workspace_workflows` (per-workspace instances) with NO row-level security, so
-- any authenticated user could read/modify another workspace's automation workflows
-- via the data API. This adds the repo's standard multi-tenant policies.
--
-- Design:
--   • workflow_templates  — SHARED platform data (no workspace_id column). Readable by
--     every authenticated user (all workspaces). Writes restricted to platform admins,
--     mirroring the app-level `requirePlatformAdmin` gate on saveWorkflowTemplate /
--     deleteWorkflowTemplate (those run under the `authenticated` role, so the DB must
--     enforce the same rule). Service-role seeds bypass RLS and are unaffected.
--   • workspace_workflows — per-workspace. Only members of the owning workspace may
--     read/write, matching growthmind_seo_sites / _strategy_centre, etc.
--
-- Idempotent: ENABLE RLS is safe to re-run; DROP POLICY IF EXISTS then CREATE.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── workflow_templates (shared platform templates) ────────────────────────────
ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;

-- Everyone signed in can read shared platform templates.
DROP POLICY IF EXISTS "workflow_templates_read_all" ON workflow_templates;
CREATE POLICY "workflow_templates_read_all" ON workflow_templates
  FOR SELECT
  USING (true);

-- Only platform admins may create/update/delete shared templates.
DROP POLICY IF EXISTS "workflow_templates_admin_write" ON workflow_templates;
CREATE POLICY "workflow_templates_admin_write" ON workflow_templates
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles   WHERE user_id = auth.uid() AND user_type = 'admin')
    OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles   WHERE user_id = auth.uid() AND user_type = 'admin')
    OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- ── workspace_workflows (per-workspace instances) ─────────────────────────────
ALTER TABLE workspace_workflows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_workflows_workspace_members" ON workspace_workflows;
CREATE POLICY "workspace_workflows_workspace_members" ON workspace_workflows
  FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- End of Workflow Engine RLS
-- ─────────────────────────────────────────────────────────────────────────────
