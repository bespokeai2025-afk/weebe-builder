---
name: Veo Gemini API endpoint
description: Correct base URL and method for Veo on Gemini Developer API; getVeoStatus table bug
---

## Rule
- Base URL: `https://generativelanguage.googleapis.com/v1beta` (NOT v1alpha)
- Submit method for Gemini Developer API: `:predictLongRunning` (NOT `:generateVideo`)
- Full submit: `POST /v1beta/models/veo-2.0-generate-001:predictLongRunning?key=API_KEY`
- Poll: `GET /v1beta/{operationName}?key=API_KEY` — operationName from `data.name` e.g. `models/veo-2.0-generate-001/operations/ID`
- Vertex AI path remains: `:predictLongRunning` on `us-central1-aiplatform.googleapis.com/v1`
- `getVeoStatus` must query `provider_settings` with `provider_category='video'` — NOT `workspace_provider_settings` (doesn't exist).

## Request body (both paths)
```json
{ "instances": [{ "prompt": "..." }], "parameters": { "aspectRatio": "16:9", "durationSeconds": "8", "sampleCount": 1 } }
```
`durationSeconds` must be a **number** (integer), NOT a string — the API returns 400 INVALID_ARGUMENT if sent as a string.

**Why:** The Python google-genai SDK uses `:predictLongRunning` on `v1beta`. The old `v1alpha/:generateVideo` endpoint was non-functional. The `workspace_provider_settings` table query was a copy-paste bug causing the Veo connected status to always read as false.

**How to apply:** Never change back to `v1alpha` or `:generateVideo` for the Gemini path. Credential lookups for Veo always go via `provider_settings.provider_category = 'video'`.
