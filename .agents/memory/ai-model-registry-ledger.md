---
name: AI model registry + usage ledger
description: Central model registry, ai_usage_ledger, Responses-API fallback client, admin AI billing dashboard
---

# AI model registry, usage ledger & billing diagnostics

- All Mind model IDs must resolve via `src/lib/ai/model-registry.server.ts` `resolveModelForRole(role)` (env-overridable per role, e.g. `HIVEMIND_CHAT_MODEL`). Never hardcode new model IDs in Mind code.
- **Why:** models change frequently (GPT-5.6 family, Veo 3.1); one registry keeps routing auditable and overridable without deploys.
- Approved OpenAI fallback chain is gpt-5.6-terra → gpt-5.5 → gpt-5.4 — NEVER gpt-4o. Fallbacks must be explicit and ledgered, never silent.
- Every AI request (success/failed/fallback/diagnostic) must be recorded via `recordAiUsage()` in `src/lib/ai/usage-ledger.server.ts` — never-throw, service-role insert into `ai_usage_ledger` (server-write-only: RLS on with zero policies + REVOKE authenticated/anon).
- GPT-5.6 calls should use `openaiResponsesCall()` (`src/lib/ai/openai-responses.server.ts`) — Responses API with reasoning effort, cached/reasoning token extraction, and per-attempt ledger rows.
- Streaming chat-completions callers need `stream_options: { include_usage: true }` and must capture the usage chunk (`j.usage`) or token counts are 0.
- Cost figures are estimates from `AI_TOKEN_COSTS`/`VIDEO_SECOND_COSTS` in `model-registry.shared.ts` — update there when provider pricing changes; reasoning tokens are billed as output.
- Admin dashboard at `/admin/ai-usage` (server fns in `src/lib/ai/ai-diagnostics.functions.ts`, all gated `requireSupabaseAuth` + `requirePlatformAdmin`); dashboard reads page past PostgREST's 1000-row cap.
- Gemini API uses `-preview` model names (veo-3.1-generate-preview etc.); Vertex `-001` names are NOT available on this key.
- **How to apply:** any new AI call site — resolve model via registry, record via recordAiUsage (including failures), never invent a bespoke fallback.
