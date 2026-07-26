# Universal Legacy Path Register — Mind Task Creation Paths

Audit of every server path that inserts `hivemind_tasks` (and related work-order rows), its
classification under the Universal Mind Intelligence Packet standard, and its repair status.

**Contract:** `src/lib/minds/intelligence-packet.shared.ts` (types + `validateUniversalMindIntelligencePacket`)
**Gate:** `src/lib/minds/intelligence-packet.server.ts` (`prepareMindTaskInsert`, `assertTaskApprovable`)
**Storage:** `hivemind_tasks.intelligence_packet / readiness_state / packet_version` and same columns
on `work_orders` (migration `20260726090000_universal_intelligence_packet.sql`).

Readiness rule: only `ready_for_*_approval` / `ready_for_execution` states are approvable.
`approveAndRunTask` refuses any gated executable task whose readiness is not approvable; rows with
NULL readiness AND NULL packet are pre-gate legacy rows (upgraded in a later phase).

| # | Path (caller) | Mind | Task type | Work order? | Resolves targets? | Evidence? | Executions? | Status / repair |
|---|---------------|------|-----------|-------------|-------------------|-----------|-------------|------------------|
| 1 | `work-orders.server.ts` `createGadsAnalysisWorkOrderCore` (chat tool + server fn) | growthmind | executable (`growthmind.gads_campaign_analysis`) | yes | yes (live synced campaigns) | yes | yes | **REPAIRED** — full packet built at creation; work order + task stored with `ready_for_analysis_approval`. |
| 2 | `growthmind-control/tools.server.ts` `create_growthmind_task` chat tool | growthmind | was shallow approvable directive | no | no | no | no | **REPAIRED** — now lands as a non-approvable investigation-state task (`investigation_required` or `target_resolution_required` via validator) with an investigation packet listing what is missing. Never executable. |
| 3 | `hivemind.actions.ts` `executeAction` `create_task` | hivemind | informational follow-up | no | from payload entity | payload packet or action-context evidence | no | **REPAIRED** — routes through `prepareMindTaskInsert`; uses proposer-supplied `action_payload.intelligence_packet` when present, else builds one from the action's own context. |
| 4 | `executive-followthrough.server.ts` `taskDraftFor` (recommendation → action) | hivemind | informational | no | yes (recommendation entity) | yes (business issue + confidence) | no | **REPAIRED** — draft payload now embeds a packet snapshot built from the recommendation's real evidence/diagnosis; consumed by path #3. |
| 5 | `hivemind.tasks.ts` `runHiveMindScan` (scanPlatform findings) | hivemind | informational | no | yes (finding entity) | yes (finding data) | no | **REPAIRED** — each finding task carries an evidence packet; classified informational. |
| 6 | `hivemind.tasks.ts` `createHiveMindTaskCore` (manual + /api/v1) | human | Human Task | no | n/a | n/a | no | **REPAIRED** — explicitly labelled `human_task` (metadata.human_task=true, task_class=human_task); bypasses packet requirement by design; can never be executable. |
| 7 | `orchestration.server.ts` `runOrchestrationPlaybook` | hivemind | informational | no | yes (playbook entity) | yes (playbook finding evidence) | no | **REPAIRED** — routed through gate with packet from real finding evidence. |
| 8 | `mind-execution-engine.server.ts` `approveAndRunTask` | any | approval/run gate | — | — | — | yes | **REPAIRED (enforcement point)** — `assertTaskApprovable` blocks gated tasks whose readiness is not approvable. |
| 9 | `accountsmind/executor.ts` (activation follow-up) | accountsmind | informational reminder | no | activation entity | activation context | no | **CLASSIFIED informational** — advisory reminder from an already-approved activation; not approvable-executable; packet adoption in AccountsMind depth phase. |
| 10 | `campaign-reports/report-writer.shared.ts` | hivemind | informational (report follow-up) | no | report entity | report row | no | **CLASSIFIED informational** — derived from a generated report; readiness gating not applicable (no approve/run surface). |
| 11 | `workflow-engine/workflow-executor.server.ts` (2 sites) | hivemind | informational (workflow step output) | no | workflow entity | step context | no | **CLASSIFIED informational** — created by an already-approved active workflow; step-level approval handled by the workflow engine. |
| 12 | `systemmind/legacy-conversion.server.ts` | systemmind | `suggested` review task | no | draft entity | conversion report | no | **CLASSIFIED informational** — points a human at a generated DRAFT; drafts themselves are approval-gated in Build Workspace. |
| 13 | `systemmind/systemmind-generators.server.ts` | systemmind | informational | no | generator entity | generator output | no | **CLASSIFIED informational** — hub-and-detail generator follow-ups; activation is separately approval-gated. |
| 14 | `growthmind/gsc-sync-core.ts` | growthmind | informational (SEO finding) | no | GSC entity | sync data | no | **CLASSIFIED informational** — advisory finding; SEO stage approvals run via `hivemind_actions`. |
| 15 | `growthmind-control/monitoring.server.ts` | growthmind | informational (health alert) | no | monitored entity | health metrics | no | **CLASSIFIED informational** — health sweep alert; no approve/run surface. |
| 16 | `hivemind/executive-reasoning.server.ts` | hivemind | informational | no | reasoned entity | reasoning evidence | no | **CLASSIFIED informational** — reasoning-layer output; its consequential follow-through goes via recommendations → path #4/#3 (gated). |
| 17 | `growthmind/content-attention-scan.server.ts` | growthmind | informational (content attention) | no | content entity | scan data | no | **CLASSIFIED informational** — advisory; content approvals run via the content approval pipeline. |

## Why "classified informational" is safe
Rows 9–17 never set `task_category = "executable"` or `action_kind`, so they can never reach
`approveAndRunTask`; the only executable creation path is #1, which is fully packet-backed. Manual
status changes on executable tasks are already rejected by `updateHiveMindTaskCore`. Later depth
phases (per-channel builders) migrate rows 9–17 onto `prepareMindTaskInsert` as each department
gains its own packet builders.

## Frontend-only creation
No frontend-only insert path exists: all UI creation goes through `createHiveMindTask` (path #6,
Human Task) or the chat tools (paths #1–#2). RLS + server fns prevent direct client inserts of
Mind-attributed tasks.
