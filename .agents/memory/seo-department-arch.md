---
name: SEO Department (GSC + blog campaigns)
description: GrowthMind SEO Department architecture — GSC sync, stage-approval campaign engine, safety gate, manual Lovable packages, mind tools, audit SSRF guard.
---

# SEO Department architecture

- Engine: `src/lib/growthmind/seo-blog-campaign.server.ts` — stage state machine strategy→brief→content→deployment. EVERY stage raises a pending `hivemind_actions` row (`action_type: seo_campaign_approval`, sensitive, category "campaign").
- **hivemind_actions has NO metadata/priority/source columns** — use `action_payload`, `proposed_by`, `sensitive`, `sensitive_category`. Inserting unknown columns fails silently if the caller swallows the error.
- Approval execution: HiveMind Action Centre executes via `executeMindTool("hivemind.<action_type>")` → any new action type needs BOTH a `HIVEMIND_ACTION_KINDS` entry in register-tools.server.ts AND a case in `executeAction` (hivemind.actions.ts) AND membership in `SENSITIVE_ACTIONS` if consequential, AND the `ActionType` union.
- Direct stage-approval server fn must gate on `requireAction(ws, user, "campaign_activation")` — auth middleware alone would bypass the sensitive-approval controls.
- Safety gate (`runSeoSafetyGate`) result stored in `growthmind_seo_campaigns.safety_results` (NOT safety_report).
- Deployment = MANUAL Lovable package only; never claim direct publishing. User marks deployed with live URL; verification via URL Inspection.
- SystemMind audit (`src/lib/systemmind/seo-tech-audit.server.ts`) fetches only property-domain URLs (`isAllowedAuditUrl` SSRF guard — live_url is user input); GitHub access is GET-only.
- AI spend logged to `growthmind_generation_logs` task_type `seo_campaign` inside `callAiJson`; AccountsMind tool `accountsmind.seo_costs` reports attribution state "unknown" until real evidence exists — never estimates.
- Empty GSC analytics = `baseline_pending` state (new properties take days); never report zeros as data.
- **Why:** shared dev/prod DB + multi-tenant approvals mean a missed gate or invented metric ships live instantly.
- Contract tests: `tests/component/seo-department-contract.test.tsx` guard these invariants.
