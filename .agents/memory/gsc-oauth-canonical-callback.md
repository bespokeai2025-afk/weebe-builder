---
name: GSC OAuth canonical callback
description: Search Console OAuth uses a server callback route with HMAC state; page URLs are never redirect URIs.
---

**Rule:** Google Search Console OAuth redirects to the canonical server route `/api/oauth/gsc-callback`, never to an app page like `/growthmind/seo`. Auth URL is built server-side from a validated `{origin, returnTo}` pair (allowlisted via the shared google-ads OAuth helpers `isAllowedOAuthOrigin`/`isSafeRelativePath`); state is a JSON payload HMAC-signed with the Google client secret, 10-minute TTL. Callback verifies state, exchanges the code server-side (`exchangeAndStoreGscCode`), stores tokens in `workspace_settings`, then 302s back with `?gsc=connected|error&gsc_msg=…`. The SEO page only reacts to the `?gsc=` result params.

**Why:** The old flow sent Google's `?code` back to the SEO page and exchanged it via a server fn taking a client-chosen `redirectUri` — caused `redirect_uri_mismatch` in prod and let the browser touch codes/URIs.

**How to apply:** Any new Google (or other OAuth) integration should mirror this: server callback route + signed state carrying origin/returnTo + origin allowlist. Each deployed origin's `<origin>/api/oauth/gsc-callback` must be registered on the Google Cloud OAuth client. Tokens are still plaintext columns (`gsc_*` in workspace_settings) — pre-existing, flagged for future encryption.
