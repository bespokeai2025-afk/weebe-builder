---
name: Google Ads Connect-with-Google OAuth
description: Architecture and safety rules for the Google Ads OAuth connect flow (provider settings + GrowthMind).
---

# Google Ads "Connect with Google" OAuth

- Start fns in `google-ads-oauth.functions.ts`; callback at `/api/oauth/google-ads-callback` (createFileRoute server GET handler).
- State = HMAC-signed base64url payload (secret derived from SERVICE_ROLE_KEY), 15-min TTL. Never trust query params beyond the signed state.
- **Why:** OAuth callbacks are unauthenticated — workspace/user identity must come from the signed state, and both `returnTo` and `origin` are attacker-influencable.
- **How to apply:** any future OAuth flow here must (1) reject `returnTo` not matching a single-slash relative path (`//evil.com` bypasses a bare `startsWith("/")` check), (2) allowlist the redirect origin (`isAllowedOAuthOrigin`: prod domains + REPLIT_DEV_DOMAIN + *.replit.dev/app), enforced at start AND in the callback.
- Refresh tokens (prefix `1//`) are exchanged for access tokens at sync time via workspace clientId/clientSecret — customers use their OWN Google Cloud OAuth client + developer token (no platform-level Google Ads app).
- Both dev and prod callback URLs must be registered as authorized redirect URIs in the customer's Google Cloud OAuth client.
- AccountsMind: `adSpendCents` is informational (client's own budget), excluded from totalCostCents/margin, current-month only (source is a rolling 30-day figure).
