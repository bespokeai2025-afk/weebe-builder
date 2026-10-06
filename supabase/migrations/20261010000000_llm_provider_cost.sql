-- Provider-accurate LLM cost, and a TTS correction.
--
-- Problem 1: every native call was charged the same flat LLM rate from
-- `cost_engine_webee_native.llm_cost_per_min` ($0.015/min), whose own notes record it as modelling
-- "GPT-4.1 text". Agents have since moved to Cerebras `gpt-oss-120b`, which is roughly 5x cheaper,
-- so the cost dashboard overstates the single largest line item on every call. There was no
-- `llm_provider` column and no "llm" rate category, so there was nothing to cost against even if
-- the breakdown had wanted to.
--
-- Problem 2: a Cerebras quota error (HTTP 402) silently falls back to OpenAI mid-call
-- (src/lib/voice/llm/gpt.ts). Recording the CONFIGURED provider would therefore be wrong for every
-- call whenever the Cerebras account is out of credit. `calls.llm_provider` is written from
-- `GraphRuntime.effectiveLlmProvider()` at call end, after any fallback has happened.
--
-- Known and deliberately NOT changed here (TTS): the seeded per-minute TTS rates were derived at
-- "~800 spoken characters/min", i.e. as if the agent talks for the entire call, while the older
-- blended rate models the same thing via `agent_talk_ratio`. The two therefore disagree by ~78%
-- for the same provider on the same call, depending only on whether `tts_provider` happened to be
-- recorded. Scaling the per-provider rate by `agent_talk_ratio` was tried and reverted, because
-- which of the two readings `$0.012/min` is meant to express is a pricing decision, not an
-- engineering one. `calcVoiceProviderCostBreakdown` keeps `ttsUsd = ttsRate * minutes`.
--
-- Apply in Supabase SQL Editor.

-- ── 1. Which LLM provider actually served the call ───────────────────────────
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS llm_provider TEXT;

COMMENT ON COLUMN calls.llm_provider IS
  'LLM that actually served this native call (cerebras/openai), recorded at call end so a mid-call Cerebras->OpenAI quota fallback is reflected. Null for Retell-deployed calls and for calls predating this column.';

-- ── 2. Seed platform default LLM rates ───────────────────────────────────────
-- USD per minute of CALL, converted from each provider's published per-token pricing using this
-- codebase's own measured prompt shape: ~600 prompt tokens/turn (the speech prompt sends one
-- system message plus the latest user turn only — no conversation history; see
-- `ConversationVm.buildSpeechMessages`), ~50 completion tokens/turn, ~6 turns/min.
-- That is ~3,600 prompt + ~300 completion tokens per minute.
--
--   cerebras gpt-oss-120b : $0.35/M in, $0.75/M out  => 3600*0.35/1e6 + 300*0.75/1e6  = $0.00148
--   openai   gpt-4.1      : $2.00/M in, $8.00/M out  => 3600*2.00/1e6 + 300*8.00/1e6  = $0.00960
--
-- These are estimates built on a measured token shape, not vendor per-minute list prices (neither
-- vendor publishes one). Re-derive them if the prompt shape or turn rate changes materially.
INSERT INTO provider_cost_rates (workspace_id, provider_category, provider_name, unit_type, cost_per_unit_usd, notes)
SELECT
  w.id,
  r.provider_category,
  r.provider_name,
  r.unit_type,
  r.cost_per_unit_usd,
  r.notes
FROM workspaces w
CROSS JOIN (VALUES
  ('llm', 'cerebras', 'minute', 0.00148, 'Cerebras gpt-oss-120b: $0.35/M input + $0.75/M output, at ~3600 in + ~300 out tokens/min (600-token prompt, no history, ~6 turns/min)'),
  ('llm', 'openai',   'minute', 0.00960, 'OpenAI gpt-4.1: $2/M input + $8/M output, at ~3600 in + ~300 out tokens/min. Also what a Cerebras quota fallback lands on')
) AS r(provider_category, provider_name, unit_type, cost_per_unit_usd, notes)
ON CONFLICT (workspace_id, provider_category, provider_name, unit_type) DO NOTHING;
