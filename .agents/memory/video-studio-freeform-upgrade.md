---
name: Video Studio Free-Form Prompt Upgrade
description: Architecture of the free-form prompt pipeline, Veo provider dual-auth, and quality rules system added to GrowthMind Video Studio.
---

## Summary
Free-Form Prompt mode added to Video Studio alongside existing Guided Builder. Prompt engine runs 10 quality checks + auto-fix pass. Dual-auth Veo provider supports Gemini API key OR legacy OAuth token.

## Key files
- `src/lib/video/providers/veo.provider.ts` — VeoProvider class (Gemini API key + Vertex AI OAuth paths); `resolveVeoConfig()` merges DB creds + env vars.
- `src/lib/growthmind/video-prompt-engine.server.ts` — `optimiseVideoPrompt()` produces 10-step pipeline (angle → hook → script → storyboard → per-scene veoPrompts → voiceover → CTA). Calls Claude Sonnet 4.5 twice (once generate, once auto-fix if any quality rule fails).
- `src/lib/growthmind/growthmind.video-studio.ts` — `generateVideoFromPrompt` server fn added after existing `generateVideo`.
- `src/components/growthmind/GrowthMindVideoStudio.tsx` — Mode tabs at top of generator card; guided/freeform panels are conditionally rendered.
- `supabase/migrations/VIDEO_STUDIO_FREEFORM_MIGRATION.sql` — **Must be applied manually** in Supabase SQL Editor. Adds columns: `original_prompt`, `optimized_prompt`, `generation_mode`, `platform`, `aspect_ratio`, `quality_checks`.

## Auth path selection (VeoProvider.authMode)
1. If `geminiApiKey` present → `generativelanguage.googleapis.com` with `?key=` param (preferred)
2. Else if `gcpProject` + `accessToken` → Vertex AI with Bearer token (legacy)
3. Else → throw "credentials not configured"

## Data flow: OptimisedScene vs StoryboardScene
`OptimisedScene` (engine output) has an extra `veoPrompt` field per scene. When saving to DB, scenes are mapped to `StoryboardScene` (drops `veoPrompt`). The scene-level veoPrompts are concatenated with " | " to form the master video generation prompt.

**Why:** `StoryboardScene` is the DB schema type — adding `veoPrompt` to it would be a schema change. The veoPrompts serve only as generation inputs, not display data.

## Free-Form mode always uses quality_mode = "premium"
The free-form route hardcodes `quality_mode: "premium"` in the DB insert and always attempts Veo generation. There is no Fast/Balanced variant for free-form — the full pipeline is the point.

## Settings update
`settings.providers.$category.tsx` — `video:google_veo` credential fields updated to:
- `geminiApiKey` (preferred, API key auth)
- `gcpProject`, `accessToken`, `location`, `veoModel` (all optional, legacy OAuth path)
The old duplicate definition was removed.
