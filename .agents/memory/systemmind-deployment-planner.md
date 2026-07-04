---
name: SystemMind Deployment Planner & Intelligence
description: Plan-only deployment intelligence layer — execution boundary, manual migration, AI template whitelisting, confidence scoring.
---

# SystemMind Deployment Planner & Intelligence

Admin-only, workspace-isolated "SystemMind Intelligence" area that turns a natural-language
deployment request into a complete, **non-executed** deployment plan, scored by a deterministic
confidence engine. Strictly additive.

## Plan-only / no-execution guarantee (do not break)
- `deployment-execution.contract.ts` is types/constants only: `AUTONOMOUS_DEPLOYMENT_ENABLED = false as const`
  and `assertExecutionDisabled()` always throws. There is **no concrete executor** and the planner module
  imports **no** n8n/provider clients.
- Plans insert with `execution_status` left at the DB default `'not_executed'`; no server path ever updates it.
- `getIntelligenceSettings` ANDs the DB flag with the code constant, so a manually-flipped DB row still
  reports disabled. **Why:** the execution boundary must not be defeatable via data.
- **How to apply:** never add an executor, never write `execution_status`, never expose a write path for
  `autonomous_deployment_enabled`. `confidence_threshold` is the ONLY writable setting.

## Storage
- 3 tables in a NEW manual-apply migration `SYSTEMMIND_DEPLOYMENT_PLANNER_MIGRATION.sql`
  (deployment_plans, template_confidence, intelligence_settings). RLS = SELECT-only for workspace members
  + service_role grants. Tables aren't in generated types → use `supabaseAdmin as any`.
- Every read/list/get/delete filters on `workspace_id`; get/delete also match `id`.
- Graceful "migration not applied": server returns `applied:false` (via `isRelationMissing`) and
  server fns throw `"MIGRATION_NOT_APPLIED"`; UI shows a MigrationNotice instead of crashing.

## AI template selection safety
- AI only *chooses among* candidate template IDs from a workspace-scoped query; returned IDs are filtered
  through `candidateIds` (a Set) so hallucinated or foreign-workspace IDs are silently dropped.
  Deterministic keyword fallback if nothing survives. **Why:** prevents cross-tenant / injected IDs.
- OpenAI key is resolved server-side only (`process.env.OPENAI_API_KEY`); never accepted from client.
  Plans store deployment-variable **keys/labels only**, never values.

## Confidence engine
- 6 deterministic dimensions, `CONFIDENCE_WEIGHTS` sum = 1.0.
- `recommended` is computed at READ time vs the current threshold (not persisted), so changing the
  threshold reflects immediately without rescoring.
- Staleness = stored `template_current_version` != template's live `current_version`.
