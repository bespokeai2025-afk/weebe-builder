---
name: HiveMind data connections + freshness
description: Durable isolation and derivation rules for HiveMind's data-health and executive intelligence blocks.
---

# HiveMind data connections & freshness — rules

- **Per-block degradation is mandatory.** Every intelligence block added to HiveMind's platform-data fetch must run inside `Promise.allSettled`/try-catch and degrade to `null`; the prompt must state a block is unavailable rather than omit it silently.
  **Why:** one failing source (e.g. a paused provider) must never break the whole executive chat.

- **`suppressed_emails` is platform-wide (no workspace_id).** Tenant-context reads may only look up addresses whose sends FAILED for that workspace — never probe successfully-delivered addresses.
  **Why:** probing arbitrary addresses lets tenant A infer suppression created by tenant B's sending activity (cross-tenant inference leak).

- **Platform-global metrics (e.g. pending `workspace_requests`) never go into tenant context.** Gate on the workspace owner being a platform admin (`profiles.user_type = 'admin'`).

- **Usage sums must page past PostgREST's 1000-row cap** (paged loop + truncation flag or DB-side aggregate). A single capped fetch silently undercounts and skews overage/upsell flags.

- **WBAH calendar/bookings live in `wbah_calls` appointment fields** (`appointment_date`/`appointment_time`/`booking_status`), NOT `calendar_bookings`. Any WBAH booking-derived feature must read those fields (Europe/London dates) and skip all `leads`-table joins.
  **Why:** WBAH's `calendar_bookings` is empty and its `leads` table is dup-inflated (~400k rows, statement timeouts); reading the standard tables produces confidently wrong "no appointments" answers.

- **Fixture gotcha:** `leads.source` enum has no "webform" — nearest valid value is "website".
