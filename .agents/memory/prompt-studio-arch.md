---
name: Prompt Studio architecture
description: 5-table schema, 12 library packs, scoring model, HiveMind wiring, and graceful migration fallback for /growthmind/prompt-studio.
---

# Prompt Studio Architecture

## Tables (PROMPT_STUDIO_MIGRATION.sql — manual apply)
- `growthmind_prompt_templates` — name, type, category (library|custom), system_prompt, user_prompt_template, variables (JSONB array), chain_steps (JSONB), tags, is_active, is_favorite
- `growthmind_prompt_versions` — version history auto-saved on every savePromptTemplate call
- `growthmind_prompt_tests` — A/B test run definitions (variants JSONB)
- `growthmind_prompt_test_outputs` — per-variant outputs + scores JSONB; template_id nullable (ON DELETE SET NULL)
- `growthmind_prompt_stats` — aggregated per template; UNIQUE(template_id, workspace_id); upserted on every test run

## Library packs
12 packs defined as `LIBRARY_PACKS` const in `growthmind.prompt-studio.ts`. Seeded per workspace (category='library') via `seedLibraryPacks` server fn. Idempotent by name check. Auto-seeded on first page load when 0 templates exist.

## Scoring
`testPromptTemplate` calls `routeGenerate` for the actual generation, then calls GPT-4o-mini with a scoring prompt to get JSON scores on 5 dimensions (quality, completeness, audience_fit, brand_fit, conversion_potential, overall). Stats upserted with rolling average.

## Key export: getPromptPerformanceSummary
Exported as a **plain async function** (not a server fn) so HiveMind's `fetchFullPlatformData` can call it via dynamic import. Returns `{ best, worst, totalUsage, overallAvg, totalTemplates, lowPerfCount }`.

## Graceful migration fallback
`getPromptTemplates` checks `error.code === "PGRST204"` and returns `{ templates: [], migrationNeeded: true }`. UI shows a migration notice banner rather than crashing.

## HiveMind wiring
- `fetchFullPlatformData` in `hivemind.ai.ts`: dynamic imports `getPromptPerformanceSummary`, stores as `promptPerformance` in return object; wrapped in try/catch so it never breaks if migration not applied.
- `buildPlatformContext`: adds PROMPT STUDIO section when `d.promptPerformance` exists.
- `generateOperatorActions` in `hivemind.actions.ts`: scanner finding #11 — proposes create_task for templates with avg_score < 6 and usage_count > 2.

**Why:** `getPromptPerformanceSummary` must be plain async (not createServerFn) because HiveMind's server fn calls it server-side; nesting server fns causes TanStack Start errors.
