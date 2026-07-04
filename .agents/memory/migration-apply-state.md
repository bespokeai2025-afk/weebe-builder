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

## Applying via Management API — gotchas (learned during full reconciliation)

- **The Management API `database/query` wraps statements in a TRANSACTION.** So
  `CREATE INDEX CONCURRENTLY` is forbidden (fails in a txn block); use plain
  `CREATE INDEX`. A whole file is applied atomically — a mid-file error rolls the
  file back cleanly, so a fixed re-run starts fresh.
- **Large-table DDL:** prepend `SET lock_timeout='8s';` to any batch touching the
  `leads` table (~390k rows) — both `ALTER TABLE ... ADD COLUMN` (brief ACCESS
  EXCLUSIVE) and `CREATE INDEX` (SHARE lock, blocks writes not reads). Fail fast
  instead of queueing behind a long txn and blocking everything.
- **The two ads migration files are broken/duplicated — never run whole:**
  `ADS_PROVIDER_CREDENTIALS_MIGRATION.sql` and `GROWTHMIND_ADS_AUTOMATION_MIGRATION.sql`
  both `CREATE TABLE` `growthmind_ad_sync_log`/`growthmind_ad_budget_alerts` with
  CONFLICTING shapes. The LIVE tables match the ADS_PROVIDER shape (they have
  `impressions_total/clicks_total/conversions_total`, and NO `account_id`), which is
  what `growthmind.ads-sync-tick.ts` inserts. So when reconciling: apply ADS_PROVIDER
  minus its two `ALTER COLUMN account_id DROP NOT NULL` (42703, col absent); apply
  AUTOMATION's 11 cols on `growthmind_ads_accounts` + `idx_ad_webhook_events_plat`
  only — SKIP `idx_ad_sync_log_account` (col absent) and `idx_ad_sync_log_workspace`
  (duplicate of `idx_gm_ad_sync_log_ws`). Consolidating these two files is open tech debt.
- **content_calendar (`20260703000000`)**: its `create policy` lines are un-guarded and
  its tables already exist → running whole errors. Extract only the 2 missing
  `growthmind_marketing_tasks` indexes.
- **provider_health_sweep_cron** schedules a pg_cron job that is INERT until
  `app_config` rows `health_sweep_url` + `health_sweep_key` (service-role key) are set —
  leave that as a deliberate manual step; do not auto-store the service-role key.
- Reusable applier: `scripts/apply-migrations.mjs` (stop-on-error, per-file, lock guard).

## Audit blind spot: root-level .sql files are NOT in supabase/migrations/

**Rule:** `scripts/audit-db-crosscheck.mjs` globs ONLY `supabase/migrations/*.sql`.
There are ALSO manual migration files at the **repo root** that it silently ignores —
each says "Apply via Supabase SQL Editor". Any true reconciliation MUST scan both
locations (`rg --files -g '*.sql'`), not just the migrations dir.

**Why:** these root files were merged as manual-apply docs and never tracked. Some
define tables that are STILL queried by current code but absent from the live DB, so
scoping an audit to `supabase/migrations/` alone reports "fully reconciled" while real
feature tables are missing (the app swallows the errors via `.catch(() => {})`, so the
features degrade silently instead of crashing — easy to miss).

**How to apply:** treat any repo-root `*_MIGRATION.sql` as a candidate; verify its
`CREATE TABLE` objects against the live schema and grep `src/` for `.from("<table>")`
before deciding applied/obsolete. Confirm object-by-object — a file can be PARTIALLY
applied (e.g. one sibling table exists while others in the same file are missing).
