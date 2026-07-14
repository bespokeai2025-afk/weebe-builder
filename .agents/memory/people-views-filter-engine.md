---
name: People Views & Campaign Filters engine
description: Workspace custom views/campaign filters — filter registry semantics, PostgREST quoting, enum-column traps, leads FK for e2e fixtures
---

# People Views & Campaign Filters

- Filter fields are registry keys (e.g. `lead_status`, `lead_source`), NOT raw column names; unknown fields are rejected with a "propose meta.<key>" hint. `meta.*` keys are always allowed.
- `not_in_list` builds a PostgREST `in.(...)` string manually — values MUST go through `quotePgrstListValue` (escapes `\` and `"`) or crafted values break the filter parser (injection class).
- **Why:** architect review flagged unsafe interpolation; hostile values (quotes/commas/parens) proved it in e2e.
- Enum-backed columns (`leads.source` = lead_source enum, `status` = lead_status enum) reject arbitrary list values at the PG level — text-operator tests/filters must target real text columns (e.g. `source_detail`).
- `NOT IN` on a NULL column excludes the row (SQL NULL semantics) — seed the column when testing not_in_list counts.
- Campaign safety exclusions (booked/DNC/opted-out/no-phone/active-campaign) are applied ON TOP of the filter in campaign mode only; missing/invalid attached filter makes the executor SKIP the campaign, never call unfiltered.
- **E2E fixture trap:** unlike most workspace_id tables, `leads` has a REAL FK to `workspaces` — e2e tests must insert a throw-away workspaces row (needs name/slug/owner_id; borrow any existing owner_id) and delete it in afterAll.
- `runFilterDryRun(sb, workspaceId, rawConfig, { mode, safety })` — first arg is the Supabase client; calling it without the client works nowhere (it was a real shipped bug in the SystemMind draft path).
- Vite-config-loaded modules (campaign executor via scheduler plugin) cannot use `@/` alias imports — use relative paths or vite.config fails to load with "Cannot find package '@/lib'".
