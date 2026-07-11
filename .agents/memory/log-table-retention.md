---
name: Log-table retention sweep
description: Daily pruning of append-only log tables from the campaign-executor tick; retention windows and keep-forever decisions.
---

# Log-table retention sweep

A daily best-effort prune runs from the 5-minute campaign-executor tick via
`src/lib/maintenance/log-retention.server.ts` (`runLogRetentionSweepServer`).

**Rule:** any new append-only log table should either get a row in
`RETENTION_RULES` there or an explicit keep-forever note in that file's header.

## Retention windows (rationale)
- `retell_webhook_events` 90d (payload ~9KB/row; only latest debug_snapshot + in-flight calls read)
- `growthmind_ad_webhook_events` 90d (write-only audit; live column is `created_at` — the
  migration file wrongly says `received_at`; live schema is ground truth)
- `hivemind_events` 180d (UI reads latest 100; scanner dedupe 1 day)
- `provider_usage_log` / `growthmind_generation_logs` 400d (widest reader = admin month
  recompute in client-costing; monthly rollups persist forever in `client_monthly_costs`)

## Design constraints
- **Why batched deletes:** a single unbounded `DELETE ... WHERE created_at < cutoff` on a
  backlog can hit the Postgres statement timeout; the sweep selects ids (limit 1000) and
  deletes `.in(ids)`, max 5 batches per table per day — leftovers wait for tomorrow.
- **Once-per-UTC-day gate is in-process** (module variable); resets on server restart, which
  is fine because a re-run with nothing to delete is cheap.
- **How to apply:** never let the sweep throw — it must not block the campaign tick.
