---
name: HiveMind streaming + conversational pipeline
description: Shared prep/tool-loop for all HiveMind chat surfaces, SSE endpoint auth model, depth/tone config rules
---

# HiveMind streaming + conversational pipeline

- All HiveMind chat surfaces (full Assistant page, orb, voice prompt) share ONE pipeline:
  `prepareHiveMindChat()` (single Promise.all: platform data + councils + knowledge RAG +
  GrowthMind command block + tool schemas + API key) and `runHiveMindToolLoop()` (bounded
  tool loop with streamed rounds). Never re-add a second bespoke prompt-assembly path — the
  non-streaming server fn `getHiveMindAIResponse` and the SSE route both consume these.
- SSE endpoint `POST /api/hivemind/chat-stream`: Bearer Supabase JWT + anon-key RLS client +
  `getClaims` + `resolveWorkspaceIdForUser` (wb_workspace_id cookie). **Never an admin client**
  for user-scoped reads. Events: status/token/done/error. Clients fall back to the server-fn
  path on stream failure; abort renders "Stopped.".
- Tone/depth live in `src/lib/hivemind/hivemind-style.shared.ts` (safe for client import):
  HIVEMIND_TONE, HIVEMIND_VOICE_TONE, DEPTH_CONFIG quick/analysis/report (260/500/900 max
  tokens), deterministic `classifyResponseDepth`, `buildHiveMindFailureMessage` (honest
  failures — errors are converted to plain messages; only OpenAI-key config errors rethrow).
- History bounding: route accepts ≤10 items × 4000 chars; prep slices to the last 6 — both
  bounds are intentional, keep them in sync if changed.
- **Why:** sequential context assembly + non-streamed replies made HiveMind feel slow
  (6.4–14.7s totals); parallel prep + streaming cut totals ~25–60% and TTFT-from-send to
  ~3.7–6.2s. Depth classification stops report-dumps on simple questions.
- **How to apply:** any new HiveMind chat surface or capability must go through
  prepareHiveMindChat/runHiveMindToolLoop; tool execution still routes via
  executeHiveMindChatTool so approval gating (blocked status) is preserved.
- Latency harnesses: `tests/e2e/hivemind-latency.e2e.test.ts` (HIVEMIND_LATENCY=1, after-mode
  HIVEMIND_LATENCY_AFTER=1) and `tests/e2e/hivemind-followup.e2e.test.ts` (HIVEMIND_FOLLOWUP=1).
