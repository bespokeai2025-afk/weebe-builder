---
name: WBAH provider minute reconciliation
description: How WBAH campaign minutes reconcile against Retell, provider cost units, and the backfill/recon scripts.
---

# WBAH provider reconciliation

- The "missing ~45 min" class of complaint is almost always a VISIBILITY bug, not lost data:
  deleted campaigns keep their usage; hide them and the table no longer sums to the workspace
  total. Rule: deleted campaigns with usage in range stay visible; only zero-usage deleted rows
  may be omitted (with a footnote).
- Independent provider check: campaign-usage.server.ts fetches the same window from WBAH's own
  Retell key (workspace_settings.retell_workspace_id) via listRetellCalls (all pages, throws on
  failure). 5-min providerCache keyed `${ws}|${startIso}|${endIso}`; cached BASE totals are
  reused but diff/status recompute against current WEBEE totals. Skipped for subset filters and
  ranges >35d. Failure → status "unavailable", never silent zeros.
- Tolerance between provider ms totals and WEBEE totals = calls × 0.5s (per-call second
  rounding of duration_seconds). Residual drift beyond that = unsynced tail calls (dialer is
  live; sync lags a few minutes) — expected, shown, not a bug.
- **Units:** Retell `call_cost.combined_cost` is USD *cents* (float). Stored in
  wbah_calls.meta.cost_usd_cents by the sync. Client charge (£0.36/min GBP) and Actual Provider
  Cost (USD) are separate concepts — never mix; missing provider cost renders
  "Provider cost unavailable", never £0/$0.
- Scripts: `scripts/wbah-backfill-retell-costs.mjs` (idempotent; --days/--offset-days/--dry-run;
  run in ≤7d chunks — a 7d window is ~8k calls and per-row updates need concurrency to fit shell
  timeouts) and `scripts/wbah-reconcile-period.mjs` (read-only per-call recon: missing/extra/
  drift). Scripts must live in the workspace (not /tmp) to resolve node_modules.
- "This month" tile/column shows only when the selected range covers the current month start —
  otherwise it duplicates "Minutes used" and confuses users.
