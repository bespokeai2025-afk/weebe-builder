---
name: GPT-5.6 routing upgrade
description: HiveMind/GrowthMind AI paths on GPT-5.6 via Responses API with deterministic task router; conventions for extending it.
---

# GPT-5.6 routing upgrade (executive Minds)

HiveMind chat/briefing/DNA/exec-reasoning and GrowthMind chat/briefing run on the GPT-5.6 family (terra=standard, sol=executive/analysis, luna=background) through the OpenAI Responses API. Deterministic router: `classifyAiTask()` in `src/lib/ai/task-router.server.ts`; single call wrapper `openaiResponsesCall()` in `src/lib/ai/openai-responses.server.ts`.

**Rules to preserve:**
- Every request must pass `routing: routingLedgerMeta(routing)` so `ai_usage_ledger.routing` JSONB (taskClass/reasoningEffort/reason) is populated — the admin AI Usage dashboard and audits depend on it.
- Fallback chain is terra→5.5→5.4 and must NEVER include gpt-4o; `resolveOpenAiFallbackChain` rejects out-of-chain env overrides loudly.
- Legacy gpt-4o chat-completions code is retained behind `AI_LEGACY_CHAT_COMPLETIONS=1` — do not delete it; new migrations should follow the same flag-gated pattern (see growthmind.ai.ts).
- GPT-5 models reject `temperature`; the wrapper omits it for `/^gpt-5/`.
- Responses API conversion traps: system→developer role, tool msgs→`function_call_output`, assistant tool_calls→`function_call` items; streaming falls back to non-streaming only if no tokens were emitted.

**Why:** consistent answer quality + auditable routing; gpt-4o fallback would silently downgrade executive answers.

**How to apply:** any new Mind/AI call site should classify via `classifyAiTask` (set `backgroundJob: true` for non-interactive jobs → luna) rather than hardcoding a model. Live verification pattern: `GPT56_ROUTING=1 npx vitest run tests/e2e/gpt56-routing.e2e.test.ts --config vitest.e2e.config.ts`.

Full repo typecheck (`npx tsc --noEmit`) cannot finish within a 2-min sandbox window — verify via vitest e2e (same aliases) + dev-server HMR logs instead.
