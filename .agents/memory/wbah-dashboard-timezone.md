---
name: WBAH dashboard timezone display
description: How and where per-workspace (WBAH) date/time display timezone is enforced, vs default browser-local formatting for every other workspace.
---

DB timestamps are stored as UTC ISO strings everywhere; display formatting (not the data) is what
varies. Default behavior across the app is implicit browser-local time via bare
`toLocaleString`/`toLocaleDateString`/`toLocaleTimeString` calls (no `timeZone` option) — this is
intentional for most workspaces and also the source of an existing, unrelated SSR/client hydration
warning ("Date formatting in a user's locale which doesn't match the server") that predates and is
independent of the WBAH work below; it applies broadly since the server process has its own default
locale/zone.

For the WebUyAnyHouse (WBAH) workspace specifically, all customer-facing timestamps must render in
UK local time (`Europe/London`, auto-adjusts GMT/BST) rather than the viewer's browser-local zone,
because that workspace's business operates in the UK.

**Why:** WBAH staff view the dashboard from various browser timezones (reported as showing PDT);
the underlying data is correct UTC, but the display needs to be anchored to UK time regardless of
viewer location — this is a workspace-specific product decision, not a bug in the data.

**How to apply:** Reuse `src/lib/dashboard/wbah-timezone.ts` — exports `WBAH_TIMEZONE =
"Europe/London"` and `wbahDateTimeOptions(isWbah, opts)` (merges `timeZone: WBAH_TIMEZONE` into
Intl/toLocaleString options only when `isWbah` is true). Two call patterns exist in the codebase:
- Files/components that are *always* WBAH-only (e.g. `wbah-appointment-display.ts`, WBAH-only
  call-history drill-down dialogs gated behind a `WbahCallCountBadge`) hardcode
  `{ timeZone: WBAH_TIMEZONE }` or pass `true` directly — no `isWbah` variable needed because one
  may not be in scope in that function.
- Shared/generic date-formatting functions used by both WBAH and non-WBAH data (e.g. `fmtDate`,
  `fmtCallDate`, `fmtTs` in the leads/qualified/data routes) take an `isWbah` parameter (default
  `false`) threaded from the calling component's already-resolved workspace flag.
Before hardcoding an `isWbah` reference at a new call site, verify it is actually in scope in that
function — some WBAH-named helper components/functions are nested/defined separately from the
parent route component that holds the `isWbah` state, and referencing it there is a bug, not a fix.

Known gaps intentionally left out of this pattern (no workspace-awareness infra exists there yet):
Pipeline page, Analytics page, HiveMind pages, and the generic `DynamicDataTable` component in
`data.tsx`.
