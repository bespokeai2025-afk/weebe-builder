---
name: AccountsMind config builder, onboarding assistant & health checks
description: Extension kinds on the SystemMind Automation Layer — safety invariants, derived-state rules, and the e2e test pattern against the shared DB.
---

# AccountsMind config / onboarding plan / health check (automation-layer kinds)

Three additional `action_kind`s dispatched from `activateSystemMindAutomation`:
`accountsmind_config` and `onboarding_plan` (drafts → approval → activation), plus an
on-demand deterministic health-check engine (no draft/AI — runs directly).

**Safety invariants (keep these):**
- Stats/widgets may only reference the server-side `METRIC_REGISTRY` whitelist; unknown metric
  keys are silently dropped by the sanitiser, and an all-dropped payload refuses activation.
- Metrics flagged `sensitive` (billing/cost) are forced `client_visible=false` at generation
  AND re-forced at activation (defence-in-depth against tampered drafts). Currency custom
  fields are internal-only by default too.
- The client dashboard read (`getClientVisibleDashboardServer`) ALSO strips sensitive-metric
  stats/widgets, their values and their snapshot series at read time — even a tampered
  `client_visible=true` DB row can't leak cost data. Guarded by
  `tests/e2e/accountsmind-client-visible-sensitive.e2e.test.ts`; keep new client-facing metric
  reads behind the same filter.
- **Every activation kind must call `assertNoCredentialValues` during its activation-time
  re-validation, not just at generation.** Architect review caught `activateOnboardingPlanKind`
  missing it — a TOCTOU hole (tampered stored draft could persist credential-shaped values).
  **How to apply:** when adding a new action_kind, mirror the pattern: zod re-parse → sanitise →
  assertNoCredentialValues → refuse-if-empty, all inside the activate function.
- Onboarding checklist completion is NEVER stored — every read re-derives done/not-done live via
  `runChecksServer` (CHECK_REGISTRY). Some checks pass from platform env alone
  (voice_provider_connected passes whenever RETELL_API_KEY exists), so "empty workspace ⇒ all
  false" is NOT true — tests/logic must not assume it.
- Health checks NEVER auto-fix; they propose pending `create_task` rows in hivemind_actions,
  deduped by `action_payload.health_check_key` while a prior proposal is still pending.

**Privilege hardening rule (review-enforced):** server-write-only tables must
`REVOKE ALL ON TABLE ... FROM authenticated, anon;` then `GRANT SELECT` back — revoking only
INSERT/UPDATE/DELETE leaves TRUNCATE/REFERENCES/TRIGGER from Supabase default grants, a
cross-workspace destruction risk despite RLS.

**E2E test pattern against the shared DB:**
- Use a random-UUID throw-away workspace (these tables have no FK on workspace_id); clean up by
  workspace_id afterAll across every touched table.
- Give vitest its own minimal alias-only config — do NOT reuse vite.config.ts; its plugins
  (relays/schedulers) start real side effects inside the test runner.
- "Empty workspace ⇒ all checks false" is wrong (env-var-based checks pass everywhere).
