---
name: Conversion tracking & Google Ads attribution
description: Server-side conversion_events ledger, click-ID capture, gated Google Ads offline upload, diagnostics panel
---

# Conversion tracking layer

- `conversion_events` table (migration 20260920200000, APPLIED): unique `dedup_key`, RLS members-select, server-write-only (revoke pattern). `leads` gained gclid/gbraid/wbraid; `ava_call_requests` gained `attribution` jsonb.
- Recording: `recordConversionEvent()` in `src/lib/tracking/conversion-events.server.ts` fires only AFTER a lead genuinely exists (webform, contact form, qualified Ava call). Dedup = 23505 on dedup_key + 24h lead-level `duplicate_suppressed`.
- Upload: `maybeUploadClickConversion()` gates on real click ID + `uploadConversionActionId` in google_ads provider settings + connected `growthmind_ads_accounts.customer_id`. Honest statuses: uploaded / upload_failed / pending_config / no_attribution / duplicate_suppressed. Never fabricate click IDs — fake gclids from public forms pass regex only; Google rejects them at upload (upload_failed), which is the accepted defense since the marketing site is external (Lovable).
- Health signal (verified/partial/broken/unavailable) via `computeConversionTrackingHealth`; consumed by GrowthMind deep analysis (conversion-dependent recs marked low-confidence) and the Conversion Diagnostics panel on ads-performance.
- **Contact-form workspace lookup bug (fixed)**: `processContactForm` used a `users!inner(email)` embed against a non-existent `public.users` table — the lookup always failed and the form silently fell back to email-only (NO lead ever created). Now resolves via `profiles` (email → default_workspace_id → membership). **Why:** any embed against a non-existent relation fails silently inside try/catch; test fallback paths with real DB reads.
- **Ava web-call funnel (Aug 2026)**: 3 Ava conversion names — `ava_call_started` (observation-only, in `OBSERVATION_ONLY_CONVERSIONS`: uploads ONLY with an explicit `conversionActionMap` entry, never falls back to the default action), `ava_qualified_lead`, `ava_appointment_booked` (primary; fires ONLY on verified Cal.com tool-result `uid`/`booking_uid` with status success — generic `id` or pending statuses never confirm). Booking dedup key = `ava_appointment_booked:{bookingUid}`; UID also travels as `record_ref.order_id` → provider `transactionId`/`orderId` for provider-side dedup across retries.
- Per-name conversion action resolution (`resolveConversionActionId`): env `GOOGLE_ADS_AVA_BOOKING_CONVERSION_ACTION_ID` (booking only) > `creds.conversionActionMap` (JSON name→id) > `uploadConversionActionId` default (except observation-only names).
- Consent: captured on the public session route (`ad_user_data_consent` granted/denied/unknown), travels in call metadata + `record_ref`; explicit "denied" → status `consent_blocked`, never uploaded. Unknown defaults to first-party CONSENT_GRANTED at upload.
- GA4 Measurement Protocol emitter (`ga4-events.server.ts`): optional (silent no-op without `GA4_MEASUREMENT_ID`+`GA4_API_SECRET` env), analytics-only — never import GA4 into Ads as a second conversion source. Deterministic client_id hashed from visitor_session_id (fallback call id).
- Lead meta linkage updates must MERGE by re-reading current `leads.meta` first — a patch built from local state clobbers deduped-lead fields.
- website Ava `call_started` hook lives INSIDE the dedicated web_call branch of the webhook processor (that branch returns before the generic call_started handling, so hooks added later never run for web calls).
- Ads-side changes (creating the upload conversion action, adding gclid passthrough on the Lovable site forms) are manual/approval-only — platform never mutates campaigns/budgets/bids/keywords/ads.
