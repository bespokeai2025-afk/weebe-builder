---
name: GrowthMind Google Ads live engine
description: Architecture and hard constraints of the live Google Ads integration (sync, recommendations, tick, UI)
---

# GrowthMind Google Ads live engine

- **Single path rule:** Google syncs ONLY via `runGadsSync` in `gads-live-core.server.ts`. The legacy tick fallback (`getGoogleCreds` + `syncGoogleAdsCampaigns` / `ads-sync-google.server.ts`) was deliberately deleted — never reintroduce a parallel Google sync path. If no account is selected, the tick records an honest "skipped".
- **Alias-free core:** the ads-sync tick is vite-config-loaded, so `gads-live-core.server.ts` (and everything it imports) must stay free of `@/` aliases and use its own createClient admin via SUPABASE_URL/SERVICE_ROLE_KEY. Server fns live separately in `gads-live.server.ts` (which may use aliases) and import core relatively.
- **No executor, ever:** approving a recommendation only inserts a `growthmind_gads_change_requests` row. There is intentionally no code path that mutates the live Google Ads account. UI copy promises this ("WEBEE never edits your live Google Ads account").
- **Honest 4-stage state:** `deriveConnectionState` performs real checks per stage (creds present → listAccessibleCustomers succeeds → customer_id set → last sync run success <60 min). Don't fake stages from stored flags.
- **No hard-coded customer IDs:** account selection flows through discovery (`listAccessibleCustomers`, MCC accounts rejected) and verify-before-persist GAQL. `selectGadsAccount` also repairs the legacy `account_id` field and mirrors selection into provider_settings credentials.
- **Token lifecycle:** access-token refresh is single-flight per workspace (in-flight promise map) with an in-process cache; `invalid_grant` → `GADS_TOKEN_REVOKED` → account row set to `needs_reconnect`, and *scheduled* (incremental) syncs skip such accounts — only manual/initial runs may retry. Callback errors out if Google returns no refresh_token (never overwrite a stored refresh token with null). Acceptance test: `tests/e2e/gads-token-refresh.e2e.test.ts` (mocked token endpoint, `__expireGadsTokenCache`).
- **Why:** the original integration stored an email as the customer ID and silently pretended to sync; the rebuild's core requirement was honesty + read-only safety.

## API version sunset lesson (July 2026)
- Google BLOCKS sunset Google Ads API versions: v20 requests now fail 400 INVALID_ARGUMENT with
  `requestError: UNSUPPORTED_VERSION` ("Version v20 is deprecated. Requests to this version will be blocked").
- Fix: `GADS_API_VERSION` in gads-live-core.server.ts defaults to v21 and is the single source of truth
  (exported `GADS_API_VERSION`/`GADS_BASE`; google-ads.adapter.ts imports GADS_BASE — no hard-coded versions anywhere).
  Env override: `GOOGLE_ADS_API_VERSION`.
- `friendlyApiError` now parses GoogleAdsFailure details via exported `parseGoogleAdsFailure()` and logs a
  structured `[gads] GoogleAdsFailure` line (version/status/codes/requestId, no secrets); UNSUPPORTED_VERSION
  gets a specific message. Expect ~annual sunsets — if 400s reappear, check for UNSUPPORTED_VERSION first.
- `normalizeGadsCustomerId()` guards gaqlSearch: only 5-12 digit IDs accepted (emails / "pending-selection"
  rejected loudly). The email in growthmind_ads_accounts.account_id was ever only a display label,
  never sent to the API.
