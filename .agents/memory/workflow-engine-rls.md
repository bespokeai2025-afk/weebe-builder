---
name: Workflow Engine RLS (shared-template vs per-workspace shapes)
description: The two distinct RLS shapes used for the workflow automation tables and why workflow_templates is not a plain workspace_members table.
---

# Workflow Engine RLS — two different policy shapes on purpose

`workflow_templates` and `workspace_workflows` (created by
`supabase/migrations/WORKFLOW_ENGINE_MIGRATION.sql`) shipped with **no RLS**. RLS was
added in `supabase/migrations/WORKFLOW_ENGINE_RLS.sql` (applied via Management API).

**Two shapes, because the tables have different tenancy:**

- `workspace_workflows` — per-workspace instances. Standard multi-tenant policy
  (`workspace_members` / `auth.uid()`), `FOR ALL`. See `workspace-rls-policy-pattern.md`.

- `workflow_templates` — **SHARED platform data, no `workspace_id` column.** So the
  members pattern does NOT apply. Instead: a `FOR SELECT USING (true)` policy (every
  signed-in user reads all templates) + a separate `FOR ALL` admin-only write policy
  gated on `profiles.user_type='admin' OR user_roles.role='admin'`.

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
