---
name: SystemMind Variable Engine
description: Agent scanner + dynamic variable registry, transformation library, review lifecycle — architecture and traps.
---

# SystemMind Variable Engine

Scans an agent build and maintains a reviewed registry of every dynamic variable, plus transformation rules and field mappings. Foundation for CRM connectors / Retell deploy / trigger-queue follow-on tasks.

## Shape
- 4 tables (migration `20260730000000_systemmind_variable_engine.sql`, applied manually to shared DB): `systemmind_agent_scans`, `systemmind_dynamic_variables`, `systemmind_transformation_rules`, `systemmind_variable_mappings`. Members SELECT RLS; all writes server-only via `supabaseAdmin` (REVOKE on authenticated).
- Server logic: `src/lib/systemmind/variable-engine.server.ts`; server fns: `variable-engine.functions.ts`; pure transforms: `variable-transforms.shared.ts` (safe client-side); UI: `SystemMindVariableEnginePage.tsx` at `/systemmind/variables`.

## Rules worth keeping
- **Re-scan must never clobber reviewed rows.** Upsert only touches rows with status `detected`; `edited/approved/rejected` rows keep their fields. **Why:** human review is the source of truth; a re-scan is a refresh, not a reset.
- Report contains credential **names only** — never values (`assertNoCredentialValues` pattern applies to any stored draft/config).
- Review edit path uses an `EDITABLE_FIELDS` whitelist; anything else (workspace_id etc.) throws "not editable".
- Mappings validate that both the variable and the transformation rule belong to the caller's workspace (cross-tenant fail = "not found").
- WBAH hard-blocked via `assertNotWbahWorkspace` on every entry point.
- Transform tester (`runTransformationTest`) returns a full trace: input → transformed (ok/error) → fallback-applied destination value → `validateByDataType` result. Fallback applies when transform fails AND a fallbackValue exists.

## How to extend
- New transformation rule type: add to `applyTransformation` in the shared file + RULE_TYPES list in the UI; unknown types throw "Unknown rule type".
- Direction enum: unassigned | crm_to_webee | webee_to_retell_precall | retell_to_webee | webee_to_crm_postcall | retell_to_crm_via_webee | bidirectional.
- e2e: `tests/e2e/variable-engine.e2e.test.ts` (config is at repo root: `vitest.e2e.config.ts`, NOT tests/e2e/).
