---
name: Supabase DB health watchdog
description: Automatic outage detection + admin alert emails for the shared Supabase project; how the probe, alerting rules, and dev/prod wiring work.
---

The platform now self-monitors Supabase health instead of relying on users noticing broken panels.

**Mechanism:** `runDbHealthWatchdogTick()` runs on the 5-minute background tick from BOTH paths —
the dev campaign-scheduler Vite plugin (loaded via `server.ssrLoadModule` so module state is shared
with server functions) and the prod `/api/public/campaign-executor` endpoint. Probe order:
Supabase Management API `GET /v1/projects/{ref}/health?services=db,rest,auth` (SUPABASE_ACCESS_TOKEN,
ref parsed from the Supabase URL), falling back to a direct PostgREST probe with the service-role key.
A Management-API 401/5xx is treated as "probe unavailable" (fall through), NOT as a DB outage.

**Alerting rules:** 2 consecutive unhealthy probes before the first alert (real 521 blips lasting
<2 min were observed during testing — single-probe alerting would false-alarm); hourly re-alerts
while down; recovery email on return to healthy. Recipients = profiles with user_type='admin'
(emails cached in-process while healthy because the DB can't be queried mid-outage), override via
`DB_ALERT_EMAILS` env var. Emails go through the direct Resend path (never through DB-dependent
dispatch, which would fail during the very outage being reported).

**Admin banner:** `/admin` layout polls an admin-gated server fn every 60s and shows a red banner
while the latest probe is unhealthy. Snapshot is in-process state — meaningful only because dev
loads the module through the SSR graph and prod is a single long-lived instance.

**Why:** a Supabase compute-op outage was only noticed via a broken Live Calls panel; this closes
that gap. e2e test at `tests/e2e/db-watchdog.e2e.test.ts` (probes the LIVE project — it will
legitimately fail during a real outage).
