---
name: Migration apply-state & how to audit it
description: Why supabase_migrations history is unreliable here and how to audit true DB schema state read-only.
---

# Migration apply-state & audit method

**Rule:** On this project `supabase_migrations.schema_migrations` is NOT a reliable
record of what's applied. Its history stops early (~`20260602000001`, ~24 rows) while
the live DB has 160+ tables. Almost everything after early-June 2026 — and ALL the
ALL_CAPS "manual-apply" migration files — was applied by hand (or never applied) and
is untracked. **Audit by actual object existence, never by the history table.**

**Why:** the repo mixes timestamped Lovable migrations (auto-tracked) with ALL_CAPS
manual migrations meant to be pasted into the Supabase SQL editor. The manual ones
never touch the history table, and several were merged in code but never run in the DB.

**How to audit (read-only):** there is no Replit PG here — the app's data is in an
external Supabase. Query it via the **Management API** (`api.supabase.com/v1/projects/
{ref}/database/query`, bearer `SUPABASE_ACCESS_TOKEN`; ref = subdomain of
`VITE_SUPABASE_URL`). `executeSql`/`replit_database` is a DIFFERENT empty DB — do not
use it to audit. Repro scripts: `scripts/audit-db-snapshot.mjs` (dumps tables/columns/
indexes/policies/functions/triggers/crons/extensions to `.local/migration_audit/`),
`scripts/audit-db-crosscheck.mjs` (parses every `supabase/migrations/*.sql` for the
objects it defines and diffs against the snapshot). Capture triggers/functions across
ALL schemas (auth.users triggers like `on_auth_user_created` are not in `public`).

**Distinguish real gaps from noise before flagging:**
- A migration's objects can be absent because a *later* migration dropped/renamed them
  (e.g. `workspace_calendar_settings`, `dashboard_sync_settings` were superseded by
  columns on `workspace_settings`). Grep `src/` for the object name — **0 code refs =
  obsolete, do NOT apply**; many refs = genuine gap.
- Dev schedulers (`provider-health-sweep`, `accountsmind-scheduler`, `video-job-poller`,
  `ads-sync`) run as in-app Vite plugins, so a missing **pg_cron** job is a PROD-only gap.
- Watch duplicate files: `WEBEE_API_ENGINE_MIGRATION.sql` and
  `20260802000000_webee_api_engine.sql` are byte-identical — apply only one.

**Applying:** manual/ALL_CAPS migrations are applied in the Supabase SQL editor (or via
the same Management API). Additive column/table adds with IF NOT EXISTS are low risk.
Only ONE Supabase DB is wired (shared `VITE_SUPABASE_URL`), so changes hit live data.
