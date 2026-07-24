---
name: SystemMind CRM connection engine
description: Executable CRM connectors (test/discover/refresh) with strict masked reads, report scrubbing, and SSRF guard — separate from runtime CRM adapters.
---

# SystemMind CRM connection engine

Connection-lifecycle-only layer (`src/lib/systemmind/crm-connections/`): unified connector
contract (testConnection with truthful evidence steps, discover, optional refreshCredentials),
one registry entry + one connector file per CRM. Runtime call adapters (`src/lib/crm/*`) are a
separate system — never merge the two; crm-definitions stays descriptive-only.

Durable rules:

- **Strict masked reads.** Every stored credential value is masked on read (`MASKED_VALUE` for
  ALL keys, not just secret-classified ones); the client learns only which keys exist.
  **Why:** "non-secret" values like baseUrl can still be sensitive, and partial masking failed
  architect security review. **How to apply:** UI prefills blank with a "stored — leave blank to
  keep" placeholder; blank/masked submitted values keep the stored value server-side.
- **Scrub external echo before persist/return.** A reflective/malicious endpoint can echo the
  Authorization header back in an error body, which lands in test-report step details. Scrub
  reports with the *decrypted* credential values (you have them server-side) plus Bearer/token
  regexes before persisting `last_test_report` or returning it.
- **SSRF guard on user-supplied endpoint URLs** (generic REST baseUrl, webhook URL): block
  private/link-local/metadata hosts with DNS resolution, at save AND at use. e2e tests opt out
  via `CRM_CONNECTIONS_ALLOW_PRIVATE_URLS=1` set before imports.
- **Don't advertise refresh you don't implement.** Client-credentials providers (Dynamics) mint
  tokens per request — set `supportsOAuthRefresh: false` or the refresh button always fails.
- Tables `systemmind_crm_connections` / `systemmind_crm_discoveries`: RLS zero-policies +
  REVOKE (server-only via service role); credentials AES-encrypted via the shared
  client-api-connections crypto (`{_enc: "iv:hex"}`).
- WEBEE internal connector writes to `leads`: `full_name`/`phone` NOT NULL, and `source` must be
  a valid `lead_source` enum ("import"; "manual" is NOT valid).
