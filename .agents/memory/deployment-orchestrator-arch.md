---
name: SystemMind Deployment Orchestrator
description: Checklist-driven, approval-gated agent deployment layer — invariants, gotchas, and how it reuses existing deploy services.
---

# SystemMind Deployment Orchestrator

Core files: `src/lib/systemmind/deployment-orchestrator.server.ts` (+ `.functions.ts`),
shared UI `src/components/systemmind/DeploymentChecklistPanel.tsx` (wired into 5 surfaces:
DeployAgentDialog, my-agents AgentCard, builder toolbar, Build Workspace "deploy" tab,
Workflows page "Deployments" tab). Tables: `systemmind_deployments`,
`systemmind_deployment_approvals` (migration applied; e2e suite
`tests/e2e/deployment-orchestrator.e2e.test.ts`, 24 tests).

## Invariants (do not break)

- **Checklist is always recomputed live** from agents.settings / custom_agent_configs /
  approvals. The snapshot persisted on the deployment row is display-only. Only whitelisted
  human overrides persist (server allow-list + zod `.strict()`).
- **Approval consume is atomic + single-use**: `UPDATE … WHERE status='approved' AND
  consumed_at IS NULL … select().maybeSingle()`. Re-validation (workspace-scoped loads,
  number-conflict re-check, full go_live checklist) happens AFTER consume; the provider call
  is the LAST step. On failure the approval stays consumed and the deployment goes
  `failed` — no silent retry.
- **Build-Workspace-linked deployments (`build_version_id` set) can never go_live here** —
  refused at request time AND in the executor; checklist routes users to Apply & Go Live.
- **Reuses the extracted services** (`buyRetellPhoneNumberService`, `importSipPhoneNumberService`,
  `assignNumberToAgentService`, `goLiveAgentService`); the manual flow delegates to the same
  functions, so behavior stays byte-identical. Never fork provider logic into the orchestrator.
- **WBAH hard-block** (id + slug) on every mutating entry point. Number-conflict detection is
  same-workspace-only by design.
- **No secrets in approval payloads**: `assertNoCredentialValues` (now includes a
  `key_[A-Za-z0-9]{24,}` Retell pattern) rejects credential-shaped strings, and
  `sip_password`/`sipPassword` are stripped before persist — password-auth SIP trunks must use
  the manual flow. The executor passes `sipPassword: undefined` always.

## Gotchas learned

- EL-native detection must mirror agent-golive: `deploymentMode === "ELEVENLABS_NATIVE" ||
  deployedElevenLabsAgentId` — NOT `voiceProvider`.
- `custom_agent_configs` real columns are workspace_id, agent_id, title, crm_mode,
  extraction_fields, crm_field_mapping (no user_id/agent_name) and it has REAL FKs — e2e
  fixtures need real workspace+agent rows.
- Client-supplied `estimated_cost_usd` is clamped server-side (0–100); it's a display figure
  for AccountsMind, never billing truth.

**Why:** deployment actions spend real money and go live to customers; every bypass class
(TOCTOU, replayed approvals, cross-workspace reads, credential persistence) was explicitly
tested for in review.

**How to apply:** any new orchestrated action type must get: approval gate + atomic consume +
post-consume re-validation, WBAH block, audit row, cost event, and an e2e test.
