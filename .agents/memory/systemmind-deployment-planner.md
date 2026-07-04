---
name: SystemMind Deployment Planner & Intelligence
description: Plan-only deployment intelligence layer — execution boundary, manual migration, knowledge-graph consultation, AI template whitelisting, confidence scoring.
---

# SystemMind Deployment Planner & Intelligence

Admin-only, workspace-isolated "SystemMind Intelligence" area that turns a natural-language
deployment request into a complete, **non-executed** deployment plan, scored by a deterministic
confidence engine. Strictly additive.

## Plan-only / no-execution guarantee (do not break)
- The execution boundary is a code constant (`AUTONOMOUS_DEPLOYMENT_ENABLED = false`) plus an
  always-throwing `assertExecutionDisabled()`. There is **no executor** and the planner imports
  **no** n8n/provider clients.
- Plans persist with the DB default execution status `'not_executed'`; no server path ever updates it.
- The settings reader ANDs the DB flag with the code constant, so a manually-flipped DB row still
  reports disabled. **Why:** the boundary must not be defeatable via data.
- **How to apply:** never add an executor, never write the execution-status column, never expose a
  write path for the autonomous-deployment flag. The confidence threshold is the ONLY writable setting.

## The planner must consult the knowledge graph (hard requirement)
- A deployment plan must be assembled from template library + CRM adapters **and** the knowledge graph.
  A first pass that only read template metadata was rejected in review.
- **Why:** the graph carries the real dependency/integration edges; ignoring it produces wrong
  ordering and misses prerequisites.
- **How to apply:** consultation is deterministic and runs in BOTH the AI and no-AI paths — after
  template selection, load graph nodes/edges (read-only), map selected templates to nodes, then use
  `depends_on` edges to (a) auto-include prerequisite templates, (b) order the plan prerequisite-first
  (topological, cycle-safe), and derive architecture/failure context + risk caveats. Graph absent /
  not built / no node match must degrade gracefully to metadata-only with a surfaced note.

## Storage & isolation
- New tables live in a NEW manual-apply migration (Supabase SQL Editor); RLS = SELECT-only for
  workspace members + service_role writes. Tables aren't in generated types → `supabaseAdmin as any`.
- Every read/list/get/delete filters on workspace_id; get/delete also match the row id.
- Missing-migration is handled everywhere: server returns `applied:false` (relation-missing) and
  server fns throw `"MIGRATION_NOT_APPLIED"`; the UI shows a notice instead of crashing.

## AI template selection safety
- The AI only *chooses among* workspace-scoped candidate IDs; returned IDs are whitelisted against
  that set, so hallucinated or foreign-workspace IDs are dropped. Deterministic keyword fallback if
  none survive. **Why:** prevents cross-tenant / injected IDs.
- The OpenAI key is resolved server-side only, never from client input. Plans store deployment-variable
  **keys/labels only**, never values.

## Confidence engine
- Deterministic weighted dimensions (weights sum to 1.0). The `recommended` flag is computed at READ
  time against the current threshold (not persisted), so a threshold change reflects immediately.
- Staleness = a template's stored version differs from its live current version.
