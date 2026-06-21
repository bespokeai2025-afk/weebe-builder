---
name: React Query prefetch staleTime + WBAH analytics voicemails
description: Why PrefetchOnLogin needs page-side staleTime to actually prevent first-visit refetches, and the WBAH-counts-voicemails analytics decision.
---

# Prefetch only avoids first-visit refetch if the PAGE query has staleTime

PrefetchOnLogin warms queries on login so pages open instantly. A prefetch with a
matching `queryKey` is NOT sufficient to skip the first-visit network fetch:

- React Query staleness is **per-observer**. When a page's `useQuery` mounts it
  checks freshness against THAT query's `staleTime`. With the default
  `staleTime: 0`, the page refetches on mount even though prefetched data already
  sits in the cache.
- `prefetchQuery({ staleTime })` only controls whether the prefetch itself
  refetches — it does NOT make the cached entry "fresh" for a component that uses
  a different `staleTime`.

**Rule:** every page query PrefetchOnLogin warms must (a) set a matching
`staleTime` (we use `5 * 60_000`) and (b) match the prefetch `queryKey` + args
EXACTLY, default-filter args included (e.g. data.tsx default `filters` is
`{ limit: 500 }`). Otherwise the prefetch is wasted.

**Also:** the Data → People sub-tabs use local `useState`, not React Query, so
they cannot be RQ-prefetched. Warm them by calling their server fns
fire-and-forget — but SEQUENTIALLY (chained awaits), never concurrently, so login
doesn't kick off several expensive WBAH CRM derivations at once.

# WBAH analytics counts voicemails; other workspaces screen them

`computeAnalytics(allCalls, includeVoicemails)` in analytics.tsx screens
voicemails by default (matches Retell "real conversation" metrics), but WBAH wants
them counted — every dial that hit voicemail is a real billed call/minute. The
page defaults `includeVm` to `isWbah` and exposes a "Voicemails: shown/hidden"
toggle. Screening had hidden ~27% of WBAH calls (≈1,581 calls / 532 min in 30d),
which is why the analytics numbers looked "too low".
