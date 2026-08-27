---
name: Marketing Action Engine
description: Governance contracts for autonomous marketing writes — must hold for every future executor.
---

# Marketing Action Engine — governance contracts

Rule: all external marketing writes flow through the engine in `src/lib/marketing/`; never call platform write APIs directly.

**Why:** the whole safety model (autonomy levels, guardrails, approvals, undo) only holds if the engine is the single write path; a bypass silently re-opens every fail-open hole below.

**How to apply** — contracts every executor and new auto-executable action type must keep:
- Autopilot may only run actions that are risk_level='low' AND in the executor's explicit `autoExecutableActionTypes` allowlist. Unknown/unlisted ⇒ approval. Never widen defaults.
- Re-read autonomy + guardrails immediately before the external write; observe/recommend ⇒ refuse even human-approved (stale) approvals; protected-target lists block approved actions too.
- Per-action budget cap applies whenever a proposed numeric budget exists — including new campaigns and zero/absent existing budgets, not just delta checks.
- The daily auto cap must count every automated attempt (incl. later failures/rollbacks) via an immutable claim timestamp, never a status-filtered or mutable-column count.
- Approval rows bind to the action and execution verifies the consumed approval id; create the approval only after the CAS to awaiting_approval.
- "Executed" = API-confirmed; "verified" = independent read-back; failures are explicit statuses, never silent fallbacks. One live undo per action (unique index race, not read-then-write).
- Aggregate daily-spend ledger does NOT exist yet — the spend guardrail is per-action only and is labeled as such; build the ledger before enabling budget autopilot in the ads executor.
