---
name: GrowthMind Multi-LLM routing
description: Architecture for multi-provider AI routing in GrowthMind Content Studio — what lives where, env vars, model IDs.
---

## Rule
`model-router.shared.ts` contains all routing constants, metadata, and pure helpers — it has NO server imports so it is safe to import in client components. Provider REST calls and routeGenerate() live in `model-router.server.ts` and `providers/*.server.ts` only.

**Why:** TanStack Start tree-shakes server code; importing a `.server.ts` file client-side causes a build error. The shared file pattern lets the UI show smart routing previews without a network round-trip.

**How to apply:** Any new routing constants (e.g. adding a model) go in `model-router.shared.ts`. Any new API call goes in the appropriate `providers/*.server.ts` and is dispatched through `routeGenerate()` in `model-router.server.ts`.

## Model IDs (as accepted by each API)
- OpenAI: `gpt-4.1`, `gpt-4.1-mini`
- Gemini: `gemini-2.5-pro`, `gemini-2.5-flash`
- Claude: `claude-sonnet-4-5`

## Required env vars (server-side only)
- `OPENAI_API_KEY` — pre-existing
- `GEMINI_API_KEY` — new, needed for Gemini
- `ANTHROPIC_API_KEY` — new, needed for Claude

## Fallback chain
gemini-2.5-pro → gpt-4.1  
claude-sonnet-4-5 → gpt-4.1  
gemini-2.5-flash → gpt-4.1-mini  
gpt-4.1 → gemini-2.5-pro  
gpt-4.1-mini → gemini-2.5-flash  

## DB tables (migration 20260629200000_growthmind_model_routing.sql)
- `growthmind_model_settings` — workspace AI mode preference (upsert on conflict workspace_id)
- `growthmind_generation_logs` — every generation logged; HiveMind reads this for weekly summary

## HiveMind integration
`fetchFullPlatformData` queries `growthmind_generation_logs` last 7 days; result surfaced in `buildPlatformContext` as "GROWTHMIND CONTENT STUDIO (this week)" section.
