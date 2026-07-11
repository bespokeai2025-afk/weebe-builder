---
name: SystemMind Automation Layer
description: Approval-first AI automation drafts — lifecycle invariants, RLS posture, and integration points.
---

# SystemMind Automation Layer

Claude (SYSTEMMIND_CLAUDE_ENABLED flag, via `routeGenerate` with GPT-4.1 fallback) generates
workspace-scoped automation **drafts only** — generation never executes anything.

**Lifecycle invariants (server-enforced in systemmind-automation.server.ts):**
- draft → pending_approval → approved → active → paused/rejected/failed; transitions gated by
  `assertTransition` + extra guards.
- pending_approval → active is a legal transition **but only** `activateSystemMindAutomation`
  (called from the HiveMind approval path) may perform it. Resume (`setDraftPausedServer(paused=false)`)
  must require current status `paused` or it becomes an approval bypass — guard exists, keep it.
- Activation re-validates + re-sanitizes payload steps (zod, ALLOWED_STEP_TYPES mirrors the
  workflow-executor step cases) — never trust what sat in the DB.

**RLS posture:** all three tables (systemmind_runs / systemmind_generated_actions /
systemmind_audit_logs) are SELECT-only for `authenticated` (FOR SELECT policies + writes revoked);
every write goes through supabaseAdmin. Supabase default privileges GRANT ALL on new tables to
`authenticated` — new "server-write-only" tables must explicitly REVOKE, a `GRANT SELECT` alone
does not remove pre-existing write grants.

**Integration:** approval flows through hivemind_actions (ActionType wired in hivemind.actions.ts,
string-literal dynamic import). UI at /systemmind/automation. Approve via
`approveHiveMindAction({data:{id,approved_by}})`.

**Known-good behavior:** if Anthropic credits are exhausted (400 credit balance too low),
routeGenerate transparently falls back to gpt-4.1 and logs status=fallback in
growthmind_generation_logs.
