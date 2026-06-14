---
name: Universal Provider Framework registry isolation
description: How to safely read provider registry state per request without cross-workspace contamination
---

# Universal Provider Framework — Registry Isolation Rule

## The Rule
The global `REGISTRY` (in `src/lib/providers/registry.ts`) is a **read-only seed** — it is populated once at module load and must never be mutated at request time.

**Always use `buildScopedView(dbRows, derivedConnected)`** to get a per-request view. It clones every entry, overlays DB row overrides, then applies derived-connected status — all in a fresh object.

**Why:** The process serves all workspaces. If `mergeDbSettings()` mutated global registry entries (the old design), one workspace's provider settings would overwrite another workspace's view in memory. This is a multi-tenant correctness and security bug.

**How to apply:**
- In any server function that needs to read provider state, call `buildScopedView(dbRows, derivedConnected)` — never `listAllProviders()` followed by `e.status = ...`.
- `getProviderRegistryData` in `providers.functions.ts` is the canonical example.
- `mergeDbSettings` has been removed from the public API; `buildScopedView` replaces it.
- `listAllProviders()`, `getProvider()`, `listProviders()` all return **clones** (safe to read, not to mutate and reuse across requests).

## Instrumented Factories
Usage tracking requires `workspaceId` context that isn't available in basic factory constructors.
Use `createInstrumentedLLMProvider`, `createInstrumentedVoiceProvider`, `createInstrumentedEmailProvider` — they wrap the inner provider and call `trackProviderUsage` on every request (success + error).

## Voice Adapter Design
Voice adapters (Retell, OpenAI, ElevenLabs) now call the real REST APIs:
- **Retell:** POST `https://api.retellai.com/v2/create-web-call` → needs `additionalConfig.retellAgentId`
- **OpenAI Realtime:** POST `https://api.openai.com/v1/realtime/sessions` → returns ephemeral `client_secret`
- **ElevenLabs:** GET `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=...` → returns signed WS URL
