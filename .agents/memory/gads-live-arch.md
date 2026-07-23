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
- **Why:** the original integration stored an email as the customer ID and silently pretended to sync; the rebuild's core requirement was honesty + read-only safety.
