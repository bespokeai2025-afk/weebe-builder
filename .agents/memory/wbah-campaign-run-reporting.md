---
name: WBAH dialler campaign run reporting
description: Per-campaign attribution + automatic start/finish emailed reports for WBAH WeeBespoke dialler campaigns.
---

# WBAH dialler campaign run reporting

- Campaign metadata lives in `wbah_campaign_snapshot`; run state in `wbah_campaign_runs`
  (one row per campaign per `run_date`, unique constraint = the atomic start-claim).
  Both members-read RLS with authenticated writes revoked (server-write-only).
- **Snapshot is refreshed only opportunistically** when a user's live campaigns-page read
  succeeds — never add background WeeBespoke polling (single-session; kicks admin out).
  The run tick reads snapshot + `wbah_calls` and refreshes calls via WBAH's OWN Retell key.
- Attribution: several campaigns share one Retell agent, so a call maps to the campaign
  with the latest London-wall-clock scheduled slot ≤ the call time.
  **Why:** agent_id alone is ambiguous (5 TTC sweeps use the same agent).
- Run lifecycle: start = first attributed call within 3h after slot → `wbah_campaign_start`
  report + email; finish = 20 quiet minutes with ≥1 call OR 3h cap (+10min grace) →
  `wbah_campaign_end` with full KPIs. Recipients = enabled `wbah_dialler_summary` schedule.
- Both new report kinds (and the summary) are gated by `WBAH_ONLY_REPORT_TYPES` in
  report-generator AND reports.functions — extend that set, don't add string checks.
- Dev tick loads the module via `server.ssrLoadModule(...)` in campaign-scheduler.plugin —
  plain imports from vite-config context can't resolve `@/` aliases.
- Verified live 2026-07-16: 9 AM + 11 AM runs auto-detected, finished, and emailed.
