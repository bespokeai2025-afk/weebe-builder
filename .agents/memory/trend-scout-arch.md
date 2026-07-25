---
name: GrowthMind Trend Scout & Competitor Intelligence
description: Durable decisions and traps for the trend discovery/scoring system (cost gates, dedup pattern, alias-free plugin chain).
---

- **Cheap-first rule**: discovery fetchers must never call AI; deterministic screening auto-runs; AI scoring is user-triggered only and gated on Business DNA having 3+ filled fields. "Analyse deeply" reuses the same scoring path with an explicit item-id list (same gates + cost logging) — never add a cheaper ungated AI path.
  **Why:** per-workspace cost control is a hard product requirement; any ungated AI entry point breaks it.
- **Daily limit applies to everyone**: the discovery daily limit is enforced for scheduler AND manual runs (manual gets +2 allowance so users can force a refresh). A scheduler-only limit is a bypass — architect review rejected that.
- **Partial unique index trap**: growthmind_trend_items' dedupe index on (workspace_id, content_hash) is PARTIAL, so PostgREST upsert onConflict can't target it. Pattern: check existing hashes then insert; on batch 23505, retry row-by-row skipping only true duplicates — never drop the whole batch (concurrent runs would silently lose fresh rows).
- **Alias-free plugin chain**: the trend-scout Vite plugin's transitive imports must stay free of `@/` aliases; detectTrendSignals was extracted into alias-free `trend-signals.server.ts` (trend-engine re-exports it, and must `import type` the types it still uses locally).
- **Feed actions write back to sources**: "block source" inserts an excluded_account + dismisses the item; "add to monitoring" inserts an industry_creator; both treat 23505 as already-done.

## Testing the discovery guards (e2e)
- `tests/e2e/trend-discovery-guards.e2e.test.ts` covers the daily-limit gate (base for scheduler, +2 for manual) and the 23505 row-by-row retry in `insertItems` (exported for tests).
- To simulate a concurrent-run duplicate race against the real DB: wrap the admin client so the dedupe `select("content_hash")` chain returns `[]` while inserts hit the real table — the batch insert then fails with a genuine 23505 from the partial unique index, exercising the retry path deterministically.
- Run markers counted for the limit = growthmind_discovery_runs rows with run_kind=discovery AND source=internal (one per full run).
