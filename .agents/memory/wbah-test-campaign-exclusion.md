---
name: WBAH test-campaign exclusion & exact attribution
description: How deleted system-test dialler campaigns are excluded from client analytics, and how wbah_calls.campaign_id got backfilled.
---

- `isWbahTestCampaign()` (wbah-campaign-reporting.server.ts) is the ONLY classifier: requires
  `is_deleted` AND (lead_status "test lead" OR word-boundary /test(ing)?/ name). Deleted REAL
  campaigns (e.g. "Rebook Initial Consultation") must never match — their history keeps attributing.
- **Why:** WBAH's Minutes Used + dialler report showed "Test"/"testing"/"Rebook Test" rows created
  during system setup testing; client asked for their removal with an honest footnote.
- **How to apply:** exclusion happens server-side in getWbahDiallerAnalytics (testExcluded
  {calls,minutes,campaigns} returned for footnote) and via `isTest` on CampaignUsageRow; the UI
  filters `isTest` rows but workspace totals still include them (footnote says so). If the snapshot
  import fails, exclusion silently disables — both catch blocks console.warn loudly.
- Attribution: wbah_calls.campaign_id was backfilled (2026-07-29, ~4.5k rows stamped) by a one-off
  script stamping only calls whose London start fell inside exactly ONE candidate campaign's
  [slot, slot+3h] window; ambiguous stay NULL and show as "estimated". Run tracker stamps new calls
  live, so estimated share shrinks naturally.
- Booking display: prefer `meta.custom_analysis.callback_datetime` (London wall-clock string) over
  date-only appointment_date — `wbahBookingWhen()` server-side, `formatAppointment()` in CampaignsTab.
