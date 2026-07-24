---
name: Retell sync & webhook layer
description: Six-state deployment sync, extraction schema deploy, and webhook dedup ledger — key invariants and traps.
---

# Retell deployment sync + webhook management layer

- Tables: `retell_deployment_state` (agent_id UNIQUE, members SELECT RLS), `retell_webhook_config` (per-workspace secret, server-only), `retell_webhook_processing` (dedup_key UNIQUE, server-only ledger). Modules: `src/lib/systemmind/retell-sync.server.ts`, `src/lib/retell/retell-webhook-management.server.ts`; UI = "Retell Sync" tab on Deployment Readiness page.
- **Six-state diff needs THREE hashes**: local builder hash, last-deployed hash, and the live hash recorded at last deploy (`last_live_hash`). Live vs `last_live_hash` decides "Retell changed"; local vs `last_deployed_hash` decides "WEBEE changed". Missing snapshot ⇒ `webee_not_deployed`, never `in_sync`.
- **Why normalization**: Retell adds server defaults/timestamps/versions on every read — naive deep-equal always reports drift. Compare only builder-owned keys and drop node `display_position`.
- **Recursive diff walker trap**: keep argument order fixed in recursion or `live_only`/`snapshot_only` labels invert at nested paths (caught by architect; regression test in tests/e2e/retell-sync.e2e.test.ts).
- **Webhook ledger is fail-open by design**: any ledger error must still process the event — never let dedup break call ingest. `transcript_updated` fast-path stays BEFORE claim/logging, never deduped.
- Dedup key = eventType + callId + payload-hash so Retell retries dedupe but distinct events on the same call pass. Replay window for call events = max(config, 24h).
- Health "total/duplicates" counts read `retell_webhook_events`, "failed/dead" read the processing ledger — tests seeding only the ledger see total=0.
- Secrets: rotate returns masked preview only; raw keys/secrets never in server-fn responses.
