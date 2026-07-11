---
name: SystemMind generators (WhatsApp / follow-up sequence / n8n conversion)
description: Hub-and-detail architecture for the three generator kinds on the SystemMind Automation Layer, activation dispatch rules, and the safety patterns that must not be weakened.
---

Three generator kinds sit on top of the SystemMind Automation Layer hub
(`systemmind_generated_actions`): `whatsapp_setup`, `follow_up_sequence`, `n8n_blueprint`
(legacy kind is `workspace_workflow`). Detail rows live in `whatsapp_setup_drafts`,
`follow_up_sequence_drafts`, `workflow_blueprints`, linked by unique `generated_action_id`.

**Rules that must hold:**
- Lifecycle status lives ONLY on the hub row; detail tables are pure detail. If a detail
  insert fails, the generator deletes the hub row (no orphan hub rows). If activation fails,
  the hub row is marked `failed` and the error re-thrown so HiveMind marks its action failed.
- Pause/resume MUST mirror to the live activated target per `activated_target_type`
  (`workspace_workflow` AND `hexmail_campaign`; `whatsapp_setup_draft` has no runtime).
  Any new kind whose activation creates something that runs needs its own mirror branch in
  `setDraftPausedServer`, or the draft shows paused while the automation keeps running.
- `activateSystemMindAutomation` dispatches by `action_kind`: the three generator kinds route
  to activation fns in the generators module via **string-literal** dynamic import (variable
  specifiers break the prod Rollup build). Hub status update + audit stay centralized in the
  dispatcher. Return shape stays `{workflow_id: activatedTargetId, draft_id}` so the HiveMind
  `activate_systemmind_automation` executor never needs changes when kinds are added.
- The ONLY activation path is HiveMind `approveHiveMindAction` → `executeAction`;
  `assertTransition` gates status moves. `action_kind` has NO check constraint, so new kinds
  need no migration on the hub table — just detail table + dispatch branch + activation fn.
- n8n conversion is **deterministic** (`classifyN8nNode` / `convertN8nNodesToSteps`); AI only
  names/describes. Code, HTTP-request, shell, sub-workflow, and AI-agent nodes are hard-blocked
  into `mapping_report.unconvertible` — never silently dropped. Webhook triggers become manual
  triggers with a warning; branch conditions come out empty with a warning. Steps are
  re-validated against StepSchema + sanitizeGeneratedSteps at BOTH draft and activation time.
- `assertNoCredentialValues` (exported from generators server file) rejects any draft whose
  JSON contains credential-shaped literals (sk-, AC/SK Twilio SIDs, EAA Meta tokens, JWTs,
  Bearer …). Drafts carry credential NAMES only. Keep this on every new generator.
- Sequence activation compiles to a hexmail campaign created **inactive with no enrollment**;
  humans enroll leads. WhatsApp activation never flips a working provider — it creates a
  HiveMind task instead when the provider isn't configured.
- RLS on all three detail tables: SELECT-only for workspace members, writes revoked from
  `authenticated` (service_role only). Migration `20260811000000` applied manually (shared DB).

**Known acceptable gap:** the activation hub-row update is not a conditional/atomic write, so
two truly concurrent approvals could double-create a target (same as the legacy path). Fix if
it ever matters: `.eq("status", draft.status)` guard on the update.
