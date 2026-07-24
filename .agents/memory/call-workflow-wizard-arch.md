---
name: SystemMind Call Workflow Wizard & Runtime
description: Setup wizard (14 evidence steps), 12-check test gate + audited override, versioned activations, call trigger/queue runtime — key rules and traps.
---

# SystemMind Call Workflow Wizard & Runtime

Runtime lives in `src/lib/systemmind/call-runtime/` (triggers/queue/pipeline/executions/tick + setup-wizard). Its tables use members-read/server-write RLS and the migrations were applied manually (shared dev/prod DB).

Rules:
- **Wizard status is live-computed, never self-reported** — `computeWizardStatus` derives all 14 steps from real rows (CRM connections, variables, deployments, triggers, queue, tests). Any new step must follow this evidence pattern.
- **Activation gate**: `activateWorkflowServer` requires `test_passed` OR an owner/admin override with a mandatory reason — override sets `admin_override` and writes a `workflow_activation_admin_override` audit row. Resume from paused skips the gate (already tested when active).
- **Versioning**: drafts get `version_number = active+1` with `parent_activation_id`; activating supersedes the old active (partial unique index enforces one active per ws+agent); rollback flips current → `rolled_back` and re-activates the parent.
- **Queue control** param is `queueId`, not `id` (`controlQueueEntryServer`) — a wrapper mismatch here fails as `queue_entry_not_found`-style silent no-ops.
- **Timeline field names are the UI contract**: execution steps store `input_masked`/`output_masked`/`completed_at` (never raw `input`/`output`); a step writes input_masked only if its handler returns `{ input }`. Any UI binding to other names silently renders nothing.
- **Health/evidence must be per-workflow**: `systemmind_integration_errors` carries `agent_id`/`activation_id`; all wizard evidence, health checks and error listings must filter by agent or one workflow's failures degrade another's status.
- **Health degradation alerts fire on upward transitions only**: the tick health sweep compares prior `health_status` vs the fresh report and alerts admins (event key `workflow_error`, mirrored to the exec stream) only when severity rank increases into degraded/failed — steady-state degraded never re-alerts each sweep.
- **Registry-surface mind tools must re-gate**: `executeMindTool` only checks membership + optional actionKey, so every call-workflow tool run-path calls `gateCallWorkflowTool` (WBAH exclusion + `requireSystemMindEdit`) to match the server-fn surface. Any new registry tool wrapping SystemMind writes needs the same.

**Why:** architect review flagged the registry surface as a write-path authorization bypass vs the server-fn surface; parity gating is the fix pattern.

E2E trap: activation runs entitlement checks, so fixtures need a workspace membership AND a subscription covering the systemmind department, plus an entitlement-cache invalidation — a bare workspace fixture silently fails the gate.
