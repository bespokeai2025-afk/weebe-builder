---
name: Executive Operator mode & cross-Mind orchestration
description: 5th HiveMind mode, orchestration playbook coordinator, gating rules, and e2e fixture traps
---

**Architecture:** executive_operator is the 5th HiveMind mode (above operator). Cross-Mind orchestration coordinator lives in `src/lib/hivemind/orchestration.server.ts` with 3 playbooks (campaign_underperforming, invoice_missing, lead_not_followed_up). Runs are proposal-only: they create suggested hivemind_tasks (with dependencies + evidence), a coordinated recommendation, escalation events on hivemind_executive_events — never direct execution, so the sensitive/approval pipeline is never bypassed. Runs log to server-write-only `hivemind_orchestration_runs` (members read via RLS).

**Gating rule (fail closed):** manual runs require operator OR executive_operator mode, enforced SERVER-side inside runOrchestrationPlaybook — UI gating alone was flagged as an authorization bypass in review. Auto (chained) runs require executive_operator only.

**Dedup:** playbooks dedup against still-open hivemind_tasks by trigger/entity, so repeated runs are safe.

**E2e fixture traps:**
- A DB trigger bumps `leads.updated_at` on EVERY write (insert and update), so PostgREST cannot fabricate a stale timestamp. Force it via the Management API SQL runner wrapped in `SET session_replication_role = replica; ... ; SET session_replication_role = DEFAULT;` (a plain Mgmt-API UPDATE still fires the trigger).
- Escalation events land in `hivemind_executive_events`, not `hivemind_events`.
- leads column is `full_name` (not `name`) — selecting a nonexistent column made detection silently return zero findings.

**Why:** review found the manual path allowed any non-observe mode; operator-class enforcement must live server-side.
**How to apply:** any new playbook = extend ORCHESTRATION_PLAYBOOKS + zod enum in orchestration.functions.ts + panel card in hivemind.actions.tsx + e2e fixture test.
