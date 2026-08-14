-- ── Cost Engine: WEBEE Native voice engine ────────────────────────────────────
-- Sits alongside cost_engine_retell. Retell bills one blended per-minute rate;
-- the native cascade bills four separate meters (TTS bytes, STT audio, LLM
-- tokens, per-call analysis), so the row models those directly instead of
-- pretending it is a single minute price.
--
-- TTS is the only meter not naturally per-minute: Fish Audio charges per UTF-8
-- byte of text. Converting needs two assumptions — how fast the agent speaks and
-- how much of the call it is speaking for — and both are stored as editable
-- fields so the estimate can be corrected against real invoices.

CREATE TABLE IF NOT EXISTS public.cost_engine_webee_native (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Fish Audio: $15 per 1M UTF-8 bytes of input text.
  tts_cost_per_1m_bytes    DECIMAL(14,8) NOT NULL DEFAULT 15,
  -- Characters of agent speech per minute of agent speech (~150 wpm).
  tts_chars_per_min        DECIMAL(14,8) NOT NULL DEFAULT 900,
  -- Share of call duration the agent is speaking, 0-1.
  agent_talk_ratio         DECIMAL(14,8) NOT NULL DEFAULT 0.5,
  -- Streaming STT runs for the whole call, both directions. Fish ASR $0.36/hr.
  stt_cost_per_min         DECIMAL(14,8) NOT NULL DEFAULT 0.006,
  -- Response generation (GPT-4.1 text).
  llm_cost_per_min         DECIMAL(14,8) NOT NULL DEFAULT 0.015,
  -- Graph edge classification: one cheap call per caller turn.
  router_cost_per_min      DECIMAL(14,8) NOT NULL DEFAULT 0.002,
  -- One post-call summarisation/extraction pass, charged per call not per minute.
  analysis_cost_per_call   DECIMAL(14,8) NOT NULL DEFAULT 0.004,
  -- Fish concurrency tier prepay, amortised over estimated monthly minutes.
  concurrency_tier_monthly DECIMAL(14,8) NOT NULL DEFAULT 0,
  estimated_monthly_minutes DECIMAL(14,2) NOT NULL DEFAULT 5000,
  is_current               BOOLEAN NOT NULL DEFAULT true,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cost_engine_webee_native ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.cost_engine_webee_native TO service_role;

INSERT INTO public.cost_engine_webee_native (notes)
SELECT 'Fish Audio S2.1 TTS + streaming STT + GPT-4.1 text. Verify against invoices.'
WHERE NOT EXISTS (SELECT 1 FROM public.cost_engine_webee_native WHERE is_current);

-- The native engine's own providers, so per-call profitability can attribute
-- spend to the same rows the Retell path uses.
INSERT INTO public.cost_engine_voice (provider, voice_id, voice_name, cost_per_character, cost_per_minute, cost_per_request, notes) VALUES
  ('Fish Audio', 's2.1-pro', 'Fish S2.1 Pro', 0.000015, 0, 0, '$15 per 1M UTF-8 bytes — roughly $0.007-0.014 per minute of speech')
ON CONFLICT DO NOTHING;

INSERT INTO public.cost_engine_llm (provider, model, input_token_cost, output_token_cost, audio_input_cost, audio_output_cost, cached_token_cost, notes) VALUES
  ('Deepgram', 'nova-2', 0, 0, 0.0043, 0, 0, 'Streaming STT $0.0043/min — audio_input_cost is used as the per-minute rate')
ON CONFLICT DO NOTHING;
