---
name: Mind execution backbone (work orders + task executions)
description: How executable HiveMind tasks dispatch real Mind adapter executions; state machine, CAS claims, resume-after-approval rules.
---

Unified work-order/execution backbone: `work_orders` + `mind_task_executions` tables layered on
`hivemind_tasks`. Executable tasks (`task_category = "executable"`) are driven ONLY by the engine
(`src/lib/hivemind/mind-execution-engine.server.ts`); manual status writes are rejected server-side
in `updateHiveMindTaskCore` AND hidden in the UI.

Rules future work must keep:
- **State machine is authoritative** — `execution-state.shared.ts` defines the allowed transitions
  (draft/awaiting_approval → queued → executing → awaiting_action_approval → verifying → done;
  blocked/failed are retryable). `transitionExecution` enforces them; never write statuses directly.
- **CAS claims, no double dispatch** — `approveAndRunTask` claims via compare-and-swap on
  `execution_status IN (awaiting_approval,draft,blocked,failed)`; a second CAS reclaims orphans
  (`queued` + `active_execution_id IS NULL`, i.e. crash between claim and execution insert).
  Rollback on dispatch failure restores pre-claim task status.
  **Why:** two approvals racing must not create two executions; a crash must not strand the task.
- **Resume failure must not strand** — if `resumeExecutionForAction` throws after an approved
  action executed, never undo the action; transition execution + task to `blocked` (retryable via
  Approve & Run) with the error as `blocked_reason`, not leave them `awaiting_action_approval`.
- **Honest states only** — GrowthMind stays advisory-only: the GAds adapter writes
  `growthmind_gads_change_requests` rows (internal), external writes are always honest-blocked.
  Consequential internal changes go through a linked `hivemind_actions` row
  (`gads_create_change_requests`) and the execution waits in `awaiting_action_approval`.
- **Approved actions run under the user's authenticated client** — if an action kind writes to a
  server-write-only table (authenticated has SELECT only, e.g. `growthmind_gads_change_requests`),
  the executor must use the admin client for those writes, workspace-scoped.
  **Why:** the whole approve→execute→resume chain died at the final insert with
  "permission denied", stranding the execution in `awaiting_action_approval`.
- **Action failure must un-strand the execution** — the approve-flow failure catch transitions the
  linked execution/task to `blocked` (retryable) exactly like the resume-failure path; never leave
  them in `awaiting_action_approval` after the action failed.
- New adapters register by dispatch kind in the engine; each adapter reports steps into the
  execution's `steps` JSONB so the UI panel (polls `getTaskExecutionDetail`, 4s while live) shows
  live progress.
