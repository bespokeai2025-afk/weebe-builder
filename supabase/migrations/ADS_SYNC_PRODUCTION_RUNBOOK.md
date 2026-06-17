# Ads Sync — Production Setup & Verification Runbook

This document covers the one-time manual steps required to activate the ads sync
pg_cron job in the production Supabase project, and how to verify it is firing.

---

## Current Production Status

Applied and verified on **2026-06-17**:

```
=== CRON JOB (cron.job) ===
jobid | jobname              | schedule       | command                             | active
------+----------------------+----------------+-------------------------------------+--------
3     | sync-ads-analytics   | */15 * * * *   | SELECT public.trigger_ads_sync()    | true

=== APP_CONFIG ===
key              | value_preview                              | updated_at
-----------------+--------------------------------------------+----------------------------
ads_sync_secret  | [REDACTED — matches CRON_SECRET secret]    | 2026-06-17 05:42:26+00
ads_sync_url     | https://webeebuilder.com/api/public/ads-   | 2026-06-17 05:34:22+00

=== AD TABLES PRESENT ===
growthmind_ad_budget_alerts
growthmind_ad_budget_caps
growthmind_ad_campaigns
growthmind_ad_performance_log
growthmind_ad_sync_log
growthmind_ad_webhook_events
growthmind_ads_accounts
```

The `growthmind_ad_sync_log` will populate once the first 15-minute cron tick fires
(at the next :00 or :15 or :30 or :45 UTC boundary).

---

## Prerequisites

| Item | Status |
|------|--------|
| `CRON_SECRET` set in Replit Secrets | ✅ Already configured |
| `20260722000000_ads_sync_cron.sql` — creates pg_cron job | ✅ Applied 2026-06-17 |
| `ADS_ANALYTICS_MIGRATION.sql` — creates ad sync tables | ✅ Applied 2026-06-17 |
| `APPLY_ADS_SYNC_CONFIG.sql` — sets app_config rows | ✅ Applied 2026-06-17 |

---

## Step 1 — Apply the cron migration

*(Already done — kept for re-application reference)*

Open the **Supabase SQL Editor** for the production project and run:

```
supabase/migrations/20260722000000_ads_sync_cron.sql
```

This creates:
- `pg_net` and `pg_cron` extensions (idempotent)
- `public.app_config` table (if not already present)
- `public.trigger_ads_sync()` SECURITY DEFINER function
- The `sync-ads-analytics` pg_cron job (`*/15 * * * *`)

---

## Step 2 — Apply the ads tables migration

*(Already done — kept for re-application reference)*

Run `supabase/migrations/ADS_ANALYTICS_MIGRATION.sql` in the SQL Editor.
This creates `growthmind_ad_sync_log` and related tables.

---

## Step 3 — Insert the app_config rows

*(Already done — kept for re-application reference)*

Open `supabase/migrations/APPLY_ADS_SYNC_CONFIG.sql`, replace `<CRON_SECRET>`
with the exact value from Replit Secrets, then run in the SQL Editor.

---

## Step 4 — Verify the cron job is registered

Run in the SQL Editor:

```sql
SELECT jobid, jobname, schedule, command, active
FROM cron.job
WHERE jobname = 'sync-ads-analytics';
```

Expected: one row with `active = true` (confirmed above).

---

## Step 5 — Check the sync log

After the first 15-minute boundary passes, run:

```sql
SELECT workspace_id, platform, campaigns_synced, spend_total, status, error_message, synced_at
FROM growthmind_ad_sync_log
ORDER BY synced_at DESC
LIMIT 20;
```

Rows appear per workspace per platform per tick (~15-minute cadence).

---

## Step 6 — Use the health endpoint to verify remotely

The `GET /api/public/ads-sync` endpoint returns the last 20 sync log entries.
It requires the same `x-cron-secret` header.

```bash
curl -s \
  -H "x-cron-secret: YOUR_CRON_SECRET" \
  https://webeebuilder.com/api/public/ads-sync \
  | jq '{last_sync: .last_sync, total_entries: .total_entries, recent_errors: .recent_errors}'
```

A healthy response looks like:

```json
{
  "last_sync": "2026-06-17T06:00:01.123Z",
  "total_entries": 4,
  "recent_errors": 0
}
```

If `last_sync` is null or more than 30 minutes old, the cron is not firing — re-check
Steps 1–3.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| No rows in `cron.job` | Migration not applied | Re-run Step 1 |
| Job present but no log entries | `app_config` rows missing or wrong secret | Re-run Step 3 |
| Log entries with `status = 'error'` | Ad platform credentials invalid | Check `provider_settings` for the workspace |
| HTTP 401 from health endpoint | Wrong `x-cron-secret` value | Use the exact value from Replit Secrets |
| HTTP 503 from POST endpoint | `CRON_SECRET` env var not set on server | Check Replit Secrets tab |
| `growthmind_ad_sync_log` does not exist | Tables migration not applied | Run `ADS_ANALYTICS_MIGRATION.sql` |

---

## Ongoing monitoring

- `growthmind_ad_sync_log` accumulates one row per platform per workspace per tick.
- Budget alerts land in `growthmind_ad_budget_alerts` (`acknowledged = false` = unread).
- The Vite dev-server plugin fires the same tick every 15 minutes in development
  (first tick after 90 s delay) — check the terminal for `[ads-sync]` lines.
