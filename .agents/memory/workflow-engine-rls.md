---
name: Workflow Engine RLS (shared-template vs per-workspace shapes)
description: The two distinct RLS shapes used for the workflow automation tables and why workflow_templates is not a plain workspace_members table.
---

# Workflow Engine RLS — two different policy shapes on purpose

ALL seven Workflow Engine tables (created by
`supabase/migrations/WORKFLOW_ENGINE_MIGRATION.sql`) shipped with **no RLS**. RLS was
added in two passes, both applied via Management API:
`supabase/migrations/WORKFLOW_ENGINE_RLS.sql` (`workflow_templates` + `workspace_workflows`)
and `supabase/migrations/WORKFLOW_ENGINE_RLS_PART2.sql` (`workflow_runs`,
`workflow_schedules`, `workflow_run_events`, `workflow_template_categories`,
`workflow_template_versions`).

**Three shapes, because the tables have different tenancy:**

- Per-workspace (own the `workspace_id` col) — standard multi-tenant policy
  (`workspace_members` / `auth.uid()`), `FOR ALL`. Covers `workspace_workflows`,
  `workflow_runs`, `workflow_schedules`. See `workspace-rls-policy-pattern.md`.

- `workflow_run_events` — **child of a run, NO `workspace_id` col.** Gate by an
  `EXISTS` join to the parent `workflow_runs` row's workspace membership (both USING
  and WITH CHECK). Same trick for any future child-of-a-workspace-row table.

- SHARED platform data, no `workspace_id` col (`workflow_templates`,
  `workflow_template_categories`, `workflow_template_versions`) — members pattern does
  NOT apply. Instead: a `FOR SELECT USING (true)` policy (every signed-in user reads
  all) + a separate `FOR ALL` admin-only write policy gated on
  `profiles.user_type='admin' OR user_roles.role='admin'`.

**Why the admin write policy (not service-role-only):** the template-management server
fns (`saveWorkflowTemplate` / `deleteWorkflowTemplate` in
`src/lib/workflow-engine/workflow-engine.functions.ts`) are app-gated by
`requirePlatformAdmin` but still run under the **authenticated** role (that middleware
reuses `context.supabase`, the publishable-key + JWT client, it does NOT switch to
service role). So the DB must allow admin writes under `authenticated`, or the admin
template UI breaks. The RLS admin check mirrors the app-level `requirePlatformAdmin`
check exactly.

**How to apply:** any *new* per-workspace automation/state table must ship the
members policy from day one. A new *shared* platform table follows the read-all +
admin-write shape above, never the members shape.

**Validation gotcha:** a data-modifying CTE (`WITH ins AS (INSERT ... RETURNING) DELETE
... WHERE id IN (SELECT id FROM ins)`) does NOT self-clean — the DELETE runs on the
pre-INSERT snapshot, so the inserted row survives. Delete test rows separately.
