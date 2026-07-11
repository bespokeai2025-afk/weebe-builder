-- ─────────────────────────────────────────────────────────────────────────────
-- Workflow Engine RLS — Part 2: close the tenant-isolation gap on the remaining
-- automation tables that WORKFLOW_ENGINE_MIGRATION.sql shipped with NO row-level
-- security. WORKFLOW_ENGINE_RLS.sql covered `workflow_templates` (shared) and
-- `workspace_workflows` (per-workspace). This file finishes the job.
--
-- Design (three distinct tenancy shapes, matching the tables' data):
--
--   Per-workspace (own the workspace_id column) — standard members policy:
--     • workflow_runs       — per-workspace execution history.
--     • workflow_schedules  — per-workspace scheduling rows.
--   Both use the repo's `workspace_members` / `auth.uid()` FOR ALL policy, exactly
--   like `workspace_workflows`.
--
--   Child data of a run (NO workspace_id column) — gate by joining to the parent:
--     • workflow_run_events — a user sees an event only if its parent run belongs to
--       one of their workspaces. USING/WITH CHECK both test the parent run's
--       workspace membership via an EXISTS join to workflow_runs.
--
--   Shared platform data (no workspace_id) — read-all + admin-write, mirroring
--   `workflow_templates`:
--     • workflow_template_categories
--     • workflow_template_versions
--   Every signed-in user reads them; only platform admins write (the app-level
--   template-management fns run under the `authenticated` role, so the DB must allow
--   admin writes there). Service-role seeds bypass RLS and are unaffected.
--
-- Idempotent: ENABLE RLS is safe to re-run; DROP POLICY IF EXISTS then CREATE.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── workflow_runs (per-workspace execution history) ───────────────────────────
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflow_runs_workspace_members" ON workflow_runs;
CREATE POLICY "workflow_runs_workspace_members" ON workflow_runs
  FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

-- ── workflow_schedules (per-workspace scheduling) ─────────────────────────────
ALTER TABLE workflow_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflow_schedules_workspace_members" ON workflow_schedules;
CREATE POLICY "workflow_schedules_workspace_members" ON workflow_schedules
  FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

-- ── workflow_run_events (child of a run, no workspace_id) ──────────────────────
-- Gate by the parent run's workspace membership.
ALTER TABLE workflow_run_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflow_run_events_via_run" ON workflow_run_events;
CREATE POLICY "workflow_run_events_via_run" ON workflow_run_events
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workflow_runs r
      WHERE r.id = workflow_run_events.run_id
        AND r.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workflow_runs r
      WHERE r.id = workflow_run_events.run_id
        AND r.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
    )
  );

-- ── workflow_template_categories (shared platform data) ───────────────────────
ALTER TABLE workflow_template_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflow_template_categories_read_all" ON workflow_template_categories;
CREATE POLICY "workflow_template_categories_read_all" ON workflow_template_categories
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "workflow_template_categories_admin_write" ON workflow_template_categories;
CREATE POLICY "workflow_template_categories_admin_write" ON workflow_template_categories
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles   WHERE user_id = auth.uid() AND user_type = 'admin')
    OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles   WHERE user_id = auth.uid() AND user_type = 'admin')
    OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- ── workflow_template_versions (shared platform data) ─────────────────────────
ALTER TABLE workflow_template_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflow_template_versions_read_all" ON workflow_template_versions;
CREATE POLICY "workflow_template_versions_read_all" ON workflow_template_versions
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "workflow_template_versions_admin_write" ON workflow_template_versions;
CREATE POLICY "workflow_template_versions_admin_write" ON workflow_template_versions
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles   WHERE user_id = auth.uid() AND user_type = 'admin')
    OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles   WHERE user_id = auth.uid() AND user_type = 'admin')
    OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- End of Workflow Engine RLS — Part 2
-- ─────────────────────────────────────────────────────────────────────────────
