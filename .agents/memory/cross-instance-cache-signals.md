---
name: Cross-instance cache invalidation signals
description: platform_cache_signals table + cache-signals.server.ts pattern for multi-instance cache invalidation
---

Package catalog and entitlements in-process caches (30s TTL) now also check a shared DB version row
(`platform_cache_signals`, server-write-only, RLS on + revoked from anon/authenticated) via
`checkCacheSignal()` throttled to one read per 5s per process. Admin writes call the existing
`invalidate*Cache()` functions, which now also `bumpCacheSignal()` (fire-and-forget, version = Date.now()
so no read-modify-write race). Result: changes propagate to every instance within ~5s.

**Why:** deployed app may scale to multiple instances; process-local invalidation alone left other
instances stale for up to the TTL.

**How to apply:** reuse `src/lib/packages/cache-signals.server.ts` for any new in-process server cache —
add a signal key, store the signal version alongside cached entries, treat version mismatch as a miss,
and bump on writes. Read paths that only need local freshness (e.g. admin matrix read) must pass
`{ broadcast: false }` to invalidate, or every page load writes a DB row. Fail-open: signal lookup
errors fall back to plain TTL behavior. e2e proof: `tests/e2e/cache-signals.e2e.test.ts`.
