---
name: Intelligence packet contract for hivemind_tasks
description: Architecture rule — every new AI Mind hivemind_tasks insert must go through prepareMindTaskInsert+buildIntelligencePacket; covers exceptions, audit tooling, and the Task #500 migration.
---

## Rule

Every new `hivemind_tasks` insert from an autonomous AI Mind MUST:
1. Call `buildIntelligencePacket({ mind, objective, intentSource, targets, evidence, diagnosis })` (from `@/lib/minds/intelligence-packet.server`)
2. Pass the result to `prepareMindTaskInsert(row, packet)` to produce the DB row
3. NOT bypass this gate — it writes `intelligence_packet` (JSONB), `readiness_state`, `packet_version`, `task_category` to the row

**Why:** Shallow tasks (no packet) cannot be approved, scored, or audited by HiveMind. The intelligence packet is the data-quality contract that enables the full AI OS loop.

**How to apply:** Any new server file that creates a `hivemind_tasks` row must import from `@/lib/minds/intelligence-packet.server`. If you have a genuine exception (alias-free module, human-task class, user-authored workflow step), add an inline comment `// JUSTIFIED-EXCEPTION (Task #500): <specific reason>` near the insert.

## Justified exceptions (as of Task #500)

| File | Reason |
| --- | --- |
| `gsc-sync-core.ts` | ALIAS-FREE: loaded at Vite config time, cannot use `@/` dynamic imports |
| `systemmind-generators.server.ts` | Setup-checklist scaffold tasks, not AI proposals |
| `legacy-conversion.server.ts` | Human-review class task (not AI output) |
| `workflow-executor.server.ts` (`create_task`, `notify_user`) | User-authored workflow step instructions |
| `hivemind_actions` inserts (growthmind, systemmind, mind-adapters) | Approval-queue records — the gate fires in `hivemind.actions.ts::executeAction` at approval time |

## Audit tooling

- `scripts/audit-mind-creators.mjs` — grep-based audit, produces JSON + `docs/CREATOR_REGISTRY.md`
- Run: `node scripts/audit-mind-creators.mjs`
- Status column: compliant | justified-exception | needs-review | disabled

## Test helpers

`src/lib/minds/legacy-creators.shared.ts` exports:
- `assertNoLegacyDirectInsert(fn, fragment)` — verifies a disabled creator throws before touching the DB
- `assertRowHasIntelligencePacket(row, opts)` — verifies a row has all packet fields set

Tests: `tests/component/legacy-creators-500.test.tsx` (21 tests covering all 5 migrated sources)

## Migrated in Task #500

- `growthmind-control/monitoring.server.ts`
- `growthmind/content-attention-scan.server.ts`
- `accountsmind/executor.ts`
- `campaign-reports/report-writer.shared.ts`
- `hivemind/executive-reasoning.server.ts`
