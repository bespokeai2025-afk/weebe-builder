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
- Ads-side changes (creating the upload conversion action, adding gclid passthrough on the Lovable site forms) are manual/approval-only — platform never mutates campaigns/budgets/bids/keywords/ads.
