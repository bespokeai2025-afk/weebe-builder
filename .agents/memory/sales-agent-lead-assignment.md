---
name: Assigned-records-only (sales agent) access pattern
description: Durable rules for restricted-role lead access, person-directed notifications, audit-first writes
---

- Restricted roles (`assignedRecordsOnly`) are enforced in application server functions, not RLS. The invariant: ANY server function whose result derives from leads — reads, mutations, call scheduling/firing, dashboard aggregates, meta-key discovery — must scope by the caller's assigned leads, failing closed to empty (use impossible-value sentinels in `.in()` filters when the assigned set is empty). Aggregates that cannot be assignment-scoped (e.g. WBAH call tables with no assignment link) return empty for restricted users.
- **Why:** the restriction is only as strong as the least-guarded function; per-lead mutation fns and workspace-wide aggregate counts are the classic leak paths.
- **How to apply:** when adding any lead-derived server fn, resolve permissions and scope every query; shared caches must key by user when output is restriction-scoped. Behavioral e2e fixtures live in the e2e suite; a source-contract component test fails if a guard string disappears.
- `workspace_members.role` is a Postgres enum AND `legacyRoleToRoleKey` fails unknown roles closed to suspended — adding a built-in role needs the enum migration plus the legacy-mapping entry, or memberships break silently.
- Assignment writes are audit-first: audit insert precedes the lead update; compensate-delete audit rows if the update fails. Never log-and-continue on audit failure.
- Person-directed notifications: `targetUserIds` on the notification engine input bypasses persisted recipient config (membership-validated); dedupe on the audit row id. New ActionKeys need a package feature mapping.
