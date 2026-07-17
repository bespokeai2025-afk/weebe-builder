---
name: SystemMind Build Setup Console
description: Guided setup layer in Build Workspace — variable scan, CRM creds/mapping, triggers, test dry-run, apply gate
---

# SystemMind Build Setup Console

- One `systemmind_setup_states` row per build session (migration 20260717120000, applied via direct Mgmt API). All reads/writes via supabaseAdmin MUST filter by workspace_id explicitly.
- **Apply gate is opt-in by existence**: `assertSetupCompleteForApply` (dynamically imported in `applyBuildVersionServer`, string-literal import) only enforces when a setup-state row exists — old sessions unaffected. The auto-scan effect in BuildSessionView creates the row for linked-agent sessions, which activates the gate.
- **No secrets in setup state**: credentials flow only through `saveProviderCredentials`/`testProviderConnection` (`{category:"crm",providerName,credentials}`); setup rows keep masked/boolean metadata, and `assertNoCredentialValues(patch, "Setup state")` runs on every write.
- Required-inputs checklist drives both the RequiredInputsPanel (anchor scroll + tab jump) and the gate; test group excluded from dry-run required set, but full set enforced at apply.
- `writeSystemMindAudit` uses targetType/targetId/finalAfterState (no `detail` field).
- **Why:** deployments were failing post-apply because agents referenced unfilled variables/CRM creds; the gate moves that validation before Apply.
- **How to apply:** any new "completeness before apply" requirement should extend `computeRequiredInputs` rather than adding bespoke checks; keep gate existence-conditional for backwards compat.

## Required Context layer (v2)
- One `context` jsonb column on the same row holds 10 grouped context blocks + `confirmed/confirmedBy/confirmedAt`. `computeContextCompleteness` derives items (crm/booking/followup groups are conditional), and `computeRequiredInputs` prepends the required ones as group `"context"` — so the Apply gate covers context automatically with no extra check.
- **Confirm-reset invariant:** any context save or auto-suggest resets `confirmed` to false; confirm blocks server-side while required items are missing. Auto-suggest fills ONLY empty fields from the agent scan and never confirms.
- **Cache-shape trap:** every setup server-fn wrapper must return the SAME shape `{ state, requiredInputs, contextCompleteness }` because mutation results are written straight into the React Query cache; a wrapper missing a key silently blanks that part of the UI. The panel treats a missing `contextCompleteness` as "loading", never as "complete".
