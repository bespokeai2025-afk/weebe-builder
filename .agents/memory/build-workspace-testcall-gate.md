---
name: Build Workspace test-call gate
description: Mandatory test-call validation loop for SystemMind build sessions — gate derivation rules and bypass traps.
---

# Build Workspace Test Call Validation Loop

Rule: for SystemMind build sessions, Go Live requires a PASSED test call (or a HiveMind-APPROVED manual pass). Standard/manual agent deployments keep the old optional test-call behavior.

**Why:** users were shipping AI-built agents live without ever hearing them work; a real-call validation loop catches broken prompts/workflows before customers do.

**How to apply:**
- Gate derives ONLY from `systemmind_test_calls` rows (real analyses or `overrideTestPassedServer`). The deployment checklist's generic `checklist_overrides.test_call = "passed"` must NEVER unlock it for build-linked deployments (was a review-caught bypass), and "skipped" never satisfies it.
- The analyzed call must belong to the session's `target_agent_id` — a passing call from another agent in the same workspace is rejected (second review-caught bypass).
- Gate is keyed by session + version: a new build version resets the gate to not_tested.
- Enforcement lives in three server paths: apply-with-go-live-intent, mark-version-deployed, and the deployment readiness checklist. Any new go-live path added later must consult the same gate.
- Unanswered scenarios (no answer / voicemail) pass on deterministic checks alone; connected scenarios need AI verdict AND no deterministic failure.
- Manual pass is HiveMind-controlled (July 2026): the override server fn only CREATES a hub draft (`action_kind build_test_override`, high risk) + pending HiveMind action; the passing row is written only at approval-time activation. Activation is version-bound — a stale approval must fail if the session's current version changed (review-caught bypass #3). A partial unique index enforces one pending request per session.
- HiveMind visibility: executive summary carries `buildWorkspace` stats + a top risk when builds are blocked at the gate; the scanner emits `build_awaiting_test_call` / `build_test_call_failed` findings for applied versions.
- e2e coverage: `tests/e2e/build-workspace-testcall.e2e.test.ts` (includes all three bypass regression tests).
