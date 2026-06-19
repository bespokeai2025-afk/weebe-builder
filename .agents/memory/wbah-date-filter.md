---
name: WBAH date-filter pattern
description: filterToDates() utility for per-day and rolling-window date filters on WBAH leads/calls/qualified pages.
---

## The pattern

```typescript
function filterToDates(filter: string): { dateFrom?: string; dateTo?: string } {
  if (filter === "all") return {};
  if (filter === "today") {
    const d = new Date();
    const from = new Date(d); from.setUTCHours(0, 0, 0, 0);
    const to   = new Date(d); to.setUTCHours(23, 59, 59, 999);
    return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
  }
  if (filter === "yesterday") {
    const d = new Date(Date.now() - 86_400_000);
    const from = new Date(d); from.setUTCHours(0, 0, 0, 0);
    const to   = new Date(d); to.setUTCHours(23, 59, 59, 999);
    return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
  }
  const days = parseInt(filter, 10);
  return isNaN(days) ? {} : { dateFrom: new Date(Date.now() - days * 86_400_000).toISOString() };
}
```

## SSR safety rule

**Call `filterToDates` inside `queryFn`, not at component render scope.**
`Date.now()` called during render differs between server and client → React hydration mismatch warning.
Putting it inside `queryFn` means it only runs client-side.

```typescript
// Correct:
queryFn: () => { const { dateFrom, dateTo } = filterToDates(filter); return fn({ data: { dateFrom, dateTo } }); }

// Wrong — called during SSR render:
const { dateFrom, dateTo } = filterToDates(filter);
queryFn: () => fn({ data: { dateFrom, dateTo } })
```

## Query key includes the filter string

`queryKey: ["leads-all", wbahDaysFilter]` — not the computed ISO dates. This keeps the key stable and human-readable while still triggering refetch when filter changes.

## Backend params

- `listLeads`: accepts `dateFrom`/`dateTo` optional on `created_at`
- `listCalls`: accepts `dateFrom`/`dateTo` optional on `started_at`; cache key includes `:from:...:to:...` segments
- `getOverviewStats`: still uses `daysSince` (rolling window); per-day support not yet wired

## Auto-reload guard

Leads page has same guard as Calls page: `leadsQ.isError` → `window.location.reload()` max 1×/20s via sessionStorage timestamp. Fixes "all zeros" from stale TanStack server fn IDs after dev restarts.

**Why:** `parseInt("today", 10)` returns NaN, so old rolling-window cutoff logic silently showed all records when "today"/"yesterday" was selected. Must use `filterToDates` everywhere.
