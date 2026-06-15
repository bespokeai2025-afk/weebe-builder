---
name: Veo Gemini API endpoint method
description: Correct REST method names for Veo video generation depending on auth path
---

## Rule
- **Gemini Developer API** (`generativelanguage.googleapis.com/v1beta`): use `:generateVideo`
- **Vertex AI** (`us-central1-aiplatform.googleapis.com/v1`): use `:predictLongRunning`

Mixing them up gives 404: "models/veo-3.0-generate-preview is not found for API version v1beta, or is not supported for predictLongRunning."

## Request body
Both paths use `instances`/`parameters` schema:
```json
{ "instances": [{ "prompt": "..." }], "parameters": { "aspectRatio": "16:9", "durationSeconds": "8", "sampleCount": 1 } }
```
Key difference: `durationSeconds` must be a **string** on Gemini API, an **integer** on Vertex AI.

**Why:** The two APIs are served by different Google backends and have separate method registries. `predictLongRunning` is a Vertex AI convention; the Gemini Developer API exposes video generation under its own `generateVideo` method name.

**How to apply:** In VeoProvider.generateVideo(), the `doRequest` closure already branches on `this.authMode`. Always keep the two endpoint strings separate and never reuse `predictLongRunning` on the Gemini path.
