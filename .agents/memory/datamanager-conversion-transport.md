---
name: Data Manager conversion transport
description: Offline conversion uploads use Google Data Manager API as primary; legacy uploadClickConversions only behind a flag; scope reauth trap.
---

# Data Manager API is the primary conversion-upload transport

- Offline conversions (conversion_events ledger) are ingested via `POST datamanager.googleapis.com/v1/events:ingest` (scope `https://www.googleapis.com/auth/datamanager`), NOT the Google Ads `uploadClickConversions` mutate.
- **Why:** Google moved offline-conversion ingestion to Data Manager (June 2026); legacy path is deprecated and account-allowlisted only.
- **How to apply:** any new conversion delivery path must route through the Data Manager uploader; the legacy adapter only runs when `google_ads` provider settings contain `legacyClickConversionFallback: "true"` — never both for the same event (each transport claims the row via CAS `recorded|queued → upload_attempted`).

## Traps
- **Scope reauth:** tokens granted before the datamanager scope was added CANNOT use the API (403 ACCESS_TOKEN_SCOPE_INSUFFICIENT). Store `grantedScopes` from the token response at connect time and treat missing scope as reauthorisation-required (hold in `pending_config`), never assume.
- **Accepted ≠ verified:** ingest acceptance returns a `requestId`; events stay `verification_pending` until `requestStatus:retrieve` reports SUCCESS (→ `reported`). Never mark "reported" from the ingest response alone.
- **Identifier normalisation:** Google hashes AFTER normalising — email trim/lowercase + gmail dot removal, phone strict E.164 (never guess country; UK 0-prefix is the only assumed market). Mismatched normalisation silently matches nothing.
- **Tenant boundary:** the lead PII lookup for hashed identifiers must be scoped `.eq(workspace_id)` as well as lead id — a mismatched lead_id must yield NO identifier route (enforced by a source-contract test).
- validateOnly:true is a true dry-run — safe way to verify scope/account/destination without recording a conversion.

**Connection upgrade (in-place):** DM scope is added to the existing Google Ads connection via incremental OAuth (`include_granted_scopes=true`); callback merges scopes/tokens into the SAME provider row and updates the SAME growthmind_ads_accounts row — never insert a second connection. Missing DM scope must degrade only the conversion-upload card, never the whole integration status. Readiness check = read-only GAQL conversion_action inspect + validateOnly ingest dry-run (member-gated).
