---
name: Provider healthCheck pattern
description: How healthCheck() is wired in the provider framework — adapter classes, dispatch, and derivedConnected fix
---

## The pattern

`healthCheck()` is NOT in the `LLMProvider`/`VoiceProvider`/etc. interfaces. It is added directly to each adapter class as an extra method.  
The health service (`src/lib/providers/health.server.ts`) imports adapters directly and calls `adapter.healthCheck!()` using the non-null assertion.

## Dispatch

`runProviderHealthCheck(workspaceId, category, providerName)` in `health.server.ts`:
1. Loads `provider_settings.credentials` + `workspace_settings` columns via Supabase
2. Dispatches on `${category}:${providerName}` string key
3. Instantiates the correct adapter with merged credentials
4. Calls `healthCheck()`
5. Persists result to `provider_settings.status` via `upsertProviderSetting`

## derivedConnected bug and fix

**Bug**: `buildScopedView` downgrade logic fires when `derivedConnected[key] === false` AND `entry.status === "connected"`. For providers like `llm:claude`, `derivedConnected` is `!!(process.env.ANTHROPIC_API_KEY)` — if the env var is absent but a user saved a per-workspace key, the DB status "connected" gets overridden back to "disconnected".

**Fix** in `providers.functions.ts`: extend `derivedConnected` to `OR` with `dbConnectedSet.has(key)` for all credential-saved providers. `dbConnectedSet` is built from `dbSettings` (status === "connected") before building `derivedConnected`.

**Why**: `buildScopedView` was designed for workspace_settings columns (env-var-style connections), not for per-workspace JSONB credentials. The `dbConnectedSet` OR ensures credential-saved providers are treated as "connected" in the derivedConnected map.

## Server functions

- `saveProviderCredentials` — upserts `provider_settings.credentials` JSONB + sets `status: "connected"` when any field is non-empty
- `testProviderConnection` — calls `runProviderHealthCheck`, returns `{ok, latencyMs, error?}`

Both require workspace owner/admin role.

## Settings UI

`CREDENTIAL_FIELDS` map in `settings.providers.tsx` — keyed by `"${category}:${providerName}"`. Forms expand inline in ProviderCard for any non-connected provider (including "coming_soon" if fields are defined, allowing credentials to upgrade the status).
