---
name: Microsoft Clarity + Website Change Queue
description: Clarity Data Export quirks, local quota lease, and website-change handoff honesty rules
---

## Clarity Data Export API hard limits
- `GET clarity.ms/export-data/api/v1/project-live-insights`, Bearer token (per-project, from Clarity → Settings → Data Export).
- Rolling last 1–3 days only (`numOfDays` 1-3, no backfill), max 3 dimensions, 1,000 rows/response, **10 requests/project/DAY** (429 after). Aggregate counts only.
- History must be accumulated one daily sync at a time (`clarity_metrics_daily`, attributed to today's date).

## Quota lease (the rule)
All Clarity API entry points (tick, provider health sweep, manual "Sync now") funnel through `runClaritySyncForWorkspace`, which reserves a local attempt via `__clarity_quota_v1__` inside `provider_settings.credentials` (max 8 attempts/day, ≥30-min spacing). Gated result = `quotaGated: true` — health maps it (and rateLimited) to healthy, never "broken creds".
**Why:** the 15-min health sweep or a failing tick would otherwise burn the whole 10/day quota after any transient failure.
**How to apply:** never add a new Clarity call path that bypasses `reserveClarityAttempt`; scheduled enumerations must select workspace ids only, never bulk-read tenant `credentials`.

## Website change handoff honesty
Website changes execute via the marketing engine (`platform: "website"`), producing a `growthmind_seo_deployment_packages` row in `awaiting_website_deployment` — WEBEE never edits sites; verify() means "package delivered", never "live". Executor fails closed: if the queue row can't be flipped executing→handled, the created package is deleted and the action does not confirm. Server-fn side: unchecked link updates strand rows — reopen + fail on link failure.

## Detection contract
Recommendations need signals on ≥2 distinct days (MIN_SIGNAL_DAYS) and ≥30 sessions; dedupe key = `changeType:path`; confidence boosted only when conversion_events show a real decline for the page.
