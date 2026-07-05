---
name: Workspace RLS policy pattern & how to validate it
description: The correct RLS policy shape for workspace-scoped tables, why current_setting-based policies silently break the app, and how to validate RLS faithfully.
---

# Workspace-scoped RLS: the only pattern that works, and how to prove it

**Rule.** Any workspace-scoped table that user-facing server fns touch MUST gate rows on:
```sql
CREATE POLICY "<table>_workspace_members" ON <table>
  FOR ALL
  USING     (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
```
A single `FOR ALL` policy with identical `USING` + `WITH CHECK` is complete: `USING` covers
SELECT/UPDATE(existing)/DELETE, `WITH CHECK` covers INSERT/UPDATE(new). Mirror the working
siblings: `growthmind_seo_sites`, `growthmind_content_generations`, `growthmind_strategy_centre`.

**Anti-pattern that fails closed.** Do NOT use `current_setting('app.workspace_id', true)` (or any
GUC the app never sets). Some root-level migration files shipped this. It looks isolation-correct but
denies everything for the `authenticated` role: SELECTs return zero rows, INSERT/UPDATE/DELETE throw
"new row violates row-level security policy".

**Why the trap is invisible.** `requireSupabaseAuth` (`src/integrations/supabase/auth-middleware.ts`)
builds `context.supabase` with `SUPABASE_PUBLISHABLE_KEY` + the user JWT → role `authenticated`, RLS
ENFORCED. Every user-facing GrowthMind/workspace server fn uses `.middleware([requireSupabaseAuth])`,
so it hits RLS. Only service-role paths (e.g. `cmo-analysis-tick`, `executive-bridge.server`) bypass
RLS — so a broken policy still "works" from ticks and looks fine until a real user loads the UI.

**How to VALIDATE (critical).** Management-API / `postgres` role CRUD BYPASSES RLS → false positive.
Prove RLS under the real role instead, in one transaction:
```sql
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"<member-user-uuid>","role":"authenticated"}', true);
-- auth.uid() now reads that sub
INSERT INTO <table> (workspace_id, ...) VALUES ('<workspace-they-belong-to>', ...);  -- must succeed
INSERT INTO <table> (workspace_id, ...) VALUES ('<workspace-they-DONT-belong-to>', ...); -- must be DENIED
```
Also confirm a *different* authenticated user sees 0 of the member's rows. Grants are usually already
present (Supabase default privileges give `authenticated` SELECT/INSERT/UPDATE/DELETE on new public
tables) — verify with `has_table_privilege('authenticated', 'public.<t>', 'INSERT')` before assuming.
