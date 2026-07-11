---
name: HiveMind tables RLS zero-policies gap
description: hivemind_actions/tasks/events had RLS enabled with no policies — all authenticated reads/writes silently empty; how it was found and fixed.
---

# HiveMind tables RLS zero-policies gap

The Phase 3/4 migrations created `hivemind_actions`, `hivemind_tasks`, `hivemind_events` and RLS
got enabled (blanket hardening) but **no policies were ever defined**. Result: every
`context.supabase` (authenticated) read returned `[]` and every write failed — the HiveMind action
centre looked permanently empty and `approveHiveMindAction` failed with "Cannot coerce the result
to a single JSON object" (`.single()` on 0 visible rows). Writes done via `supabaseAdmin`
(e.g. `submitDraftForApproval`) still landed, masking the problem.

**Fix:** migration `20260711000000_hivemind_rls_policies.sql` — standard workspace-members
`FOR ALL` policy (same pattern as `workspace_workflows`) on all three tables. Applied live via
Management API.

**Why:** RLS enabled + zero policies is a *silent* deny-all for `authenticated`; nothing errors,
queries just return empty. Supabase builders never throw, so UI shows "no data".

**How to apply:** when a feature reads a table via `context.supabase` and mysteriously sees
nothing while admin-side rows exist, first check
`select relrowsecurity, (select count(*) from pg_policy p where p.polrelid=c.oid) from pg_class c`
for that table. Any new table read by the authenticated client needs a members policy at creation.
