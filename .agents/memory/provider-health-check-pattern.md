---
name: Provider health check architecture
description: Durable rules for the provider framework's health check pattern, fallback wiring, and credential model decisions
---

## Health check pattern

`healthCheck()` is an optional method added to each adapter class (not part of the core interface).
`health.server.ts` imports adapters directly and calls `adapter.healthCheck!()` using the non-null assertion.
Dispatch key is `${category}:${providerName}` — each case loads stored credentials then constructs the adapter.

**Why:** Keeping healthCheck out of the interface means coming-soon adapters don't need stubs, and the health service can safely opt-in per adapter.

## Credential model rules

- Providers that use OAuth tokens (GCP Imagen, Google Veo) must source their `accessToken` from `stored.accessToken` only — never fall back to an unrelated key like `openai_api_key`.
- Providers that read workspace_settings columns use `ws.<column>` directly; providers that use per-workspace creds use `provider_settings.credentials` JSONB.

**Why:** Mixing credential sources produces misleading health results (false positives when env key happens to be valid for a different service).

## Fallback factory wiring

WithFallback variants (`createVoice/Email/WhatsApp/CalendarProviderWithFallback`) must be exported from their category `index.ts` and consumed in at least one real runtime call path.

WhatsApp runtime (`src/lib/whatsapp/runtime.ts`) is the canonical wiring point: `sendAndPersist` builds the primary config from workspace_settings, reads an optional WATI fallback from `provider_settings`, then calls `createWhatsAppProviderWithFallback`.

**How to apply:** Any new provider category that adds a WithFallback factory must also export it from its index and wire it into a runtime send/call helper (not just health.server.ts).

## Test Connection flow

The per-category settings route (`settings.providers.$category.tsx`) must save credentials before testing: `handleTest()` calls `saveFn` first, then `testFn`. This ensures `runProviderHealthCheck` reads the latest credential values from `provider_settings`.

**Why:** `testProviderConnection` server fn only reads persisted credentials; it does not accept a credentials payload. Save-then-test is the only way to test unsaved values.
