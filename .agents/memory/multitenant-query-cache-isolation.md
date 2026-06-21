---
name: Multi-tenant React Query cache isolation
description: Why cross-tenant data can leak in this SPA and the cache-clear boundary that prevents it
---

# Multi-tenant React Query cache isolation

The QueryClient is created once per app boot (`src/router.tsx`) and lives for the
entire SPA session. Many high-risk query keys are **generic strings WITHOUT a
workspace_id** (e.g. `["retell-analytics", days]`, `["dashboard-overview"]`,
leads/calls/marketing/HiveMind/GrowthMind keys), several with long `staleTime`
(15min) + `keepPreviousData`.

**Consequence:** logging out and logging in as a *different* account in the same
browser tab (no full page reload — logout/login are SPA navigations) re-uses the
same QueryClient, so the next account is served the previous workspace's cached
data. This is how non-WBAH accounts saw the live WBAH workspace's analytics.

**Why:** server side is already correctly isolated (WBAH gated by slug,
workspace_id-filtered, fail-closed Retell key, workspaceId in every server cache
key). The leak is purely the client cache surviving an account switch.

**How to apply / current mitigation:**
- Every logout handler MUST call `qc.clear()` after `supabase.auth.signOut()` and
  before navigating. There are 3 logout buttons: `app-sidebar.tsx`,
  `settings.crm.tsx`, `settings.calendar.tsx`. Keep them in lockstep — adding a
  new logout button without `qc.clear()` reintroduces the leak.
- Two boundary nets clear the cache on account change regardless of login path:
  `_authenticated.tsx` (module-level `lastAuthUserId`, clears on user-id change)
  and `PrefetchOnLogin.tsx` (module-level `lastWorkspaceId`, clears on workspace
  change). Both module vars reset on full page reload (same lifetime as the
  QueryClient).
- Because all logout paths clear synchronously, the next login starts from an
  empty cache, so there is no stale-data flicker even though `<Outlet/>` renders
  before `PrefetchOnLogin`.
- **Durable rule:** prefer scoping any *new* high-risk query key by workspace
  (or user) id. The fully-robust fix (recommended by architect, not yet done) is
  to thread workspace_id into all high-risk keys; it was deferred because the
  WBAH prefetch keys in `PrefetchOnLogin` must match each page's `useQuery` keys
  exactly, so a blanket key change is fragile.
- Do NOT change WBAH server analytics math to "fix isolation" — it is already
  correct and slug-gated.
