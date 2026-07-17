---
name: Analytics Hub call fetch paging + stale chunk reload
description: PostgREST 1000-row cap hit analytics call totals; stale hashed chunks after republish kill routes.
---

**Rule 1:** Any analytics helper that derives totals from `rows.length` must fetch via paged `.range()` loops (PAGE=1000 with a hard MAX_PAGES cap), never a single `.limit()` — PostgREST silently caps single responses at 1000 rows.
**Why:** Analytics Hub Overview showed "1000 calls" for WBAH (~10k+ calls) because fetchStandardCalls/fetchWbahCalls used `.limit(1000)`.
**How to apply:** Mirror the getWbahDiallerAnalytics paging pattern; prefer count-only or SQL aggregates for hot paths when possible.

**Rule 2:** After a republish, browsers holding the old build request old hashed chunks (assets/xyz-HASH.js) → 404 → routes "don't load" (builder page symptom). A global inline script in `__root.tsx` RootShell listens for `vite:preloadError` + dynamic-import failure errors and reloads once (sessionStorage timestamp guard, max once/20s).
**Why:** Prod logs showed 404s for old builder-*.js hashes while current assets 200'd — stale client, not broken code.
**How to apply:** Don't re-add per-page chunk reload hacks; the root guard covers all routes. Diagnose "page doesn't load in prod" by grepping deployment logs for asset 404s first.
