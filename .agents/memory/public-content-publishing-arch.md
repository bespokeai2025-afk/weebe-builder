---
name: Public Content Publishing backbone
description: Lovable blog API — content model, dual approvals, honest states, snapshot overlay for updating items, SSRF-guarded live verification.
---

# Public Content Publishing backbone (Lovable blog API)

- 4 tables: growthmind_public_sites, growthmind_public_content_items,
  growthmind_public_content_versions (JSONB `snapshot` of VERSIONED_FIELDS),
  growthmind_publication_executions (columns are `error_message`, NOT last_error;
  items have `live_verification_state`, NOT live_verified_at — column drift here
  broke mind tools/seo.ts once; contract test guards it).
- Public read layer (`public-content.server.ts`): PUBLIC_STATUSES whitelist;
  "updating" items are queried too but MUST go through `overlayPublishedSnapshots()`
  which serves the published version snapshot and drops updating items without one —
  in-progress edits are never publicly exposed. Any new public read fn must apply
  the overlay and select id/status/published_version.
- Dual approvals: content then publication, both `content_publication_approval`
  hivemind_actions (sensitive). Publish lands at `api_published`; only live
  verification can set "live". Honest wording: "API Published — Awaiting Lovable
  Frontend". sitemap.xml is Lovable's job; WEBEE only serves /sitemap-data.
- Live-verification fetch in publication-engine is SSRF-guarded via
  `isSafeVerificationHost(site.canonical_host)` — keep for any new fetch of
  customer-controlled hosts.
- Preview tokens: hashed (token_hash), 1h expiry, revoked on publish; preview
  responses always noindex.
- Contract doc: docs/LOVABLE_BLOG_INTEGRATION_CONTRACT.md; contract tests:
  tests/component/public-content-contract.test.tsx. E2E script pattern: bundle a
  ts script with esbuild --alias:@=./src and run with node (tsc times out).
