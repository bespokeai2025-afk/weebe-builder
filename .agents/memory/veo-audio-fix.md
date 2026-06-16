---
name: Veo 3 native audio — root causes and fix
description: Why "Veo Native Sound" produced silent videos, and how it was fixed.
---

## The rule
Veo 3 is now available on the **Gemini Developer API** (`veo-3.0-generate-preview`) and
generates audio **by default** — no extra parameter is needed, but you must use a Veo 3 model.
Veo 2 (`veo-2.0-generate-001`) has **zero** audio support regardless of any parameter.

## The three bugs that caused silent video

1. **Wrong default model on Gemini path**: `DEFAULT_MODEL_GEMINI = "veo-2.0-generate-001"`.
   Veo 2 simply cannot produce audio. Changed to `veo-3.0-generate-preview`.

2. **`generateAudio` param missing from Gemini API request body**: only the Vertex AI path
   sent it. For Veo 3 on Gemini, audio is on by default anyway, but the param is now included
   conditionally via `isAudioCapableModel(model)` for correctness.

3. **UI toggle gated only on Vertex creds**: `audioSupported = !!veoStatus?.hasVertexCreds`
   disabled the toggle for all Gemini API key users. Fixed to:
   `!!veoStatus?.hasGeminiKey || !!veoStatus?.hasVertexCreds`.

## Key distinction
- **Gemini Developer API + Veo 3**: audio is always-on; `generateAudio=false` is a no-op.
- **Vertex AI + Veo 3**: `generateAudio` is fully controllable.

## Tracking
`has_audio` boolean column added to `growthmind_video_assets` (migration: `VEO_AUDIO_FIX_MIGRATION.sql`, manual apply).
Both insert sites (`generateVideo` guided + `generateVideoFromPrompt` free-form) gracefully
fall back and drop the column if the migration hasn't been applied yet.

**Why:** Future changes to the video provider or model selection must preserve this
distinction — switching a workspace back to `veo-2.0-generate-001` should set `has_audio = false`.
