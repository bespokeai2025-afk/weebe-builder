---
name: Build Workspace apply protection
description: Impact analysis, conflict severities, apply modes, rollback snapshots and the FK fixture trap for the SystemMind Build Workspace protection layer.
---

# Build Workspace apply protection

Engine: `src/lib/systemmind/build-protection.server.ts`; wired into every apply in
`build-workspace.server.ts` (`applyBuildVersionServer` / `performBuildApply` /
`activateBuildWorkspaceApplyKind`). Snapshots table `systemmind_build_snapshots`
(migration `20260713000000`, applied via `scripts/apply-systemmind-build-snapshots-migration.mjs`,
hooked into `scripts/post-merge.sh`).

## Durable rules
- **Impact analysis runs on EVERY apply** (and again at hub activation — TOCTOU). Conflict
  severities: `block` (refuse: workspace/agent mismatch, referenced-variable-removed,
  duplicate trigger when the overwrite target is itself ACTIVE), `needs_approval` (live
  target, LIVE agent, webhook change — routes through HiveMind approval), `block_go_live`
  (draft apply OK, Go Live refused — missing WhatsApp provider, duplicate trigger on an
  inactive/new target). High risk (`classifyDraftRisk`) always forces approval too. A live
  agent can NEVER be direct-overwritten without approval.
- **Apply modes**: `direct` (overwrite after snapshot; only when no blocks/gates),
  `new_draft` (fresh inactive row, target untouched), `duplicate_edit` (clone then apply),
  `propose` (straight to approval). Approved hub payload's mode is honored but restricted to
  direct/new_draft/duplicate_edit at activation. Block conflicts are mode-aware: overwrite-
  only blocks (duplicate_trigger) don't stop touch-nothing modes (new_draft/duplicate_edit).
- **Safe by default**: only a completely fresh target (no workflow row, no agent config, no
  live agent) defaults to `direct`; ANY existing target defaults to `new_draft` — the user
  must explicitly opt in to overwrite via the safety panel (server + UI mirror this rule).
- **Snapshot BEFORE any mutation of an existing target**; snapshot failure aborts the apply.
  Rollback restores whitelisted fields on `workspace_workflows` + `custom_agent_configs`
  ONLY (never agents.settings/credentials), recreates deleted rows by id, refuses
  cross-workspace state, marks `restored_at`.
- **Why:** applies write over live customer setups sharing one prod DB — a silent overwrite
  is unrecoverable without the prior-state snapshot.

## E2E fixture trap
Most workspace-scoped tables have NO FK on workspace_id (random-UUID workspace pattern
works), but `custom_agent_configs` has real FKs on BOTH `workspace_id → workspaces` and
`agent_id → agents`, and `agents.user_id` is NOT NULL. Tests needing those rows must insert
real `workspaces` (borrow an existing `owner_id`) + `agents` fixtures and delete them in
afterAll. See `tests/e2e/build-workspace-protection.e2e.test.ts`.
