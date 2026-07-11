---
name: Lead-intake auto-calling standard setup
description: How the reusable "Lead generation webform intake setup" is wired, activated, and the RLS gaps around it.
---

Standard reusable setup that auto-calls every new lead in the leads section, updates the lead's status from the call outcome, and re-queues unanswered leads for the next run.

Operative switches (ALL three needed to be live):
- `workspace_settings.lead_auto_call_enabled = true`
- `workspace_settings.lead_auto_call_agent_id` = a deployed **client_qualification** agent (`dashboardAgentType` in `agents.settings`). Only that agent type drives the status lifecycle via the qualification webhook path — other agent types will NOT update lead status.
- an active `workspace_workflows` row instantiated from the published template **"Lead generation webform intake setup"**.

Activation path: HiveMind `action_type = "activate_lead_intake_workflow"` (user-confirmed) sets the switches and materialises/flips the workflow active (dedup by `template_id`). Re-runs over the leads are driven by campaign filters, not by the template itself.

**Why / gotchas:**
- `workflow_templates.name` has NO unique constraint → any seed must select-by-name then update/insert; the SQL migration append uses `WHERE NOT EXISTS`, not `ON CONFLICT` (no constraint to conflict on).
- `workflow_templates` / `workspace_workflows` currently have **no RLS policies at all** → any authenticated user can read/write them cross-tenant via PostgREST. Pre-existing; the activation relies on it (authenticated `sb`). Harden in a follow-up if touching these tables.
- `workspace_settings` RLS restricts INSERT/UPDATE to owner/admin → a non-admin approving the HiveMind action fails with an RLS error (marked failed gracefully). Approval must be by a workspace admin; the proposal description says so.
- The 3-calls/number/UTC-day cap is a shared guardrail (auto-call-on-new-lead, manual calls, campaign re-runs); check-then-insert is not atomic, so same-batch duplicate numbers can race past it (same as the pre-existing auto-call path).

**How to apply:** reuse for a new client via the builder "custom" agent → "Use the standard lead-gen webform intake setup" preset (fills canonical qualification prompt + sets category `client_qualification`), deploy, then enable via HiveMind. SystemMind platform KB already carries a note (seed_key `standard-lead-generation-webform-intake-setup`).
