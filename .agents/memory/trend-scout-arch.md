---
name: GrowthMind Trend Scout & Competitor Intelligence
description: Architecture and traps for the trend discovery/scoring system (sources, discovery engine, AI scoring gates, cost controls).
---

- **Cheap-first split**: discovery (8 fetchers: internal signals, owned Meta, IG business discovery, Meta Ad Library, Google Trends RSS, YouTube RSS, Reddit, news) never calls AI. Deterministic screening auto-runs; AI scoring is user-triggered only, gated on Business DNA having 3+ filled fields.
- **DNA column names**: growthmind_business_dna uses `company_name`, `products`, `ideal_customer_profiles`, `target_markets`, `unique_selling_points`, `brand_voice`, `main_growth_objective` — NOT business_name/target_audience/usp/tone_of_voice.
- **Partial unique index trap**: growthmind_trend_items unique index on (workspace_id, content_hash) is PARTIAL (WHERE content_hash IS NOT NULL), so PostgREST upsert onConflict can't target it. Pattern: check existing hashes then insert; on batch 23505, retry row-by-row skipping only true duplicates (never drop the whole batch).
- **Daily limit fairness**: growthmind_discovery_daily_limit is enforced for scheduler AND user-triggered runs (user gets +2 allowance). Run count = growthmind_discovery_runs rows with source='internal' (one per full run) per UTC day.
- **Alias-free plugin chain**: trend-scout.plugin.ts (vite-config-loaded) → trend-discovery.server.ts must stay free of `@/` imports transitively — detectTrendSignals was extracted from growthmind.trend-engine.ts into alias-free trend-signals.server.ts for this reason (trend-engine re-exports it).
- **Cost logging**: every run (discovery + scoring) logs to growthmind_discovery_runs (RLS members SELECT, service_role writes); retention rule 180d in log-retention.server.ts. Migration 20260823000000 applied live.
