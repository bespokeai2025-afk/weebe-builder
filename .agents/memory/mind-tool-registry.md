---
name: Shared Mind tool registry
description: One registry + execution entrypoint for all Mind capabilities; audit table mind_tool_executions; guard ordering and traps.
---

# Shared Mind tool registry (src/lib/minds/)

- `tool-registry.shared.ts` — client-safe MindToolMeta types; `tool-registry.server.ts` — REGISTRY + `executeMindTool()` + `auditServerFnToolRun()`; `register-tools.server.ts` — registers all 12 HiveMind action kinds plus declared GrowthMind/SystemMind/AccountsMind capabilities; `tool-catalog.functions.ts` — `getMindToolCatalog` (per-user allowed flags).
- **Rule:** any new consequential Mind capability must be registered here (or wrapped with `auditServerFnToolRun`) so it inherits membership, entitlement, mode-gate and approval semantics plus the `mind_tool_executions` audit trail automatically.
- **Why:** the Shared Intelligence Contract requires web/mobile/API to expose identical capabilities with identical permission/approval semantics and a truthful audit trail (no optimistic success).
- **How to apply:** HiveMind approve flow (`approveHiveMindAction`) dispatches through `executeMindTool` which calls back into `executeAction` (now exported) — both directions use string-literal dynamic imports to avoid a static cycle. Guard order in the entrypoint: membership → requireAction entitlement → mode gate (Mind-initiated writes only) → sensitive-approval → zod input → run with running→completed/failed audit updates.
- Trap: entitlement guard fires BEFORE the sensitive-approval check, so a workspace whose package lacks the department gets `blocked`, not `approval_required` — e2e fixtures must insert a `workspace_subscriptions` row (packages grant via `aiDepartments`, not per-action flags) and call `invalidateEntitlementsCache(ws)`.
- Audit writes are best-effort via supabaseAdmin (table is server-write-only, members SELECT); scrubToolParams redacts credential-shaped keys/values before storage.
- e2e: `tests/e2e/mind-tool-registry.e2e.test.ts` (vitest.e2e.config.ts, real DB, random-UUID workspace fixture).
