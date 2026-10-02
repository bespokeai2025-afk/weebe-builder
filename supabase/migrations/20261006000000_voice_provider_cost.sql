-- Voice provider-accurate cost tracking.
--
-- Problem: `calls.cost_cents` (and the builder Cost tab's breakdown) priced every native call
-- against ONE blended, admin-edited rate (`cost_engine_webee_native`), regardless of which STT
-- provider (Fish / Deepgram / AssemblyAI / Cartesia) or TTS provider (Fish / OpenAI / Cartesia)
-- the call actually used — a call on AssemblyAI and a call on Deepgram were costed identically.
-- There was also no telephony line at all: a web test call (no real carrier behind it) and a real
-- phone call were indistinguishable in the breakdown.
--
-- Fix: persist which STT/TTS provider a call actually used (captured live by
-- `NativeCallLifecycle.setProviderInfo`, src/lib/voice/lifecycle/call-lifecycle.ts), and look up
-- each one's real per-minute rate from the existing `provider_cost_rates` table (previously
-- populated for email/image/video/etc. but never for voice) instead of the blended figure.
--
-- Apply in Supabase SQL Editor.

-- ── 1. Which STT/TTS provider a call actually used ────────────────────────────
-- Null for a Retell-deployed agent (no such concept there — Retell's own `call_cost` already
-- covers it) and for any call made before this migration.
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS stt_provider TEXT,
  ADD COLUMN IF NOT EXISTS tts_provider TEXT;

COMMENT ON COLUMN calls.stt_provider IS
  'STT engine this native call actually used (fish/deepgram/assemblyai/cartesia/openai). Null for Retell-deployed calls.';
COMMENT ON COLUMN calls.tts_provider IS
  'TTS engine this native call actually used (fish/openai/cartesia). Null for Retell-deployed calls.';

-- ── 2. Seed platform default rates for the "voice" categories ────────────────
-- unit_type is always 'minute' here — every provider below publishes (or can be reasonably
-- approximated as) a per-minute rate, which is what a call's duration can be multiplied against.
-- Workspaces can override any row the same way they already override email/image/etc. rates.
--
-- "telephony"/"web_estimate" is new: a browser test call (call_type = 'web_call') has no real
-- carrier behind it, so there is nothing to reconcile against — unlike a real phone call, where
-- Twilio's own invoice is the source of truth and this rate is shown for reference only, not
-- added into `calls.cost_cents` (see src/lib/voice/lifecycle/cost.ts's existing no-double-count
-- comment). The web estimate exists purely so a test call's breakdown shows a realistic "if this
-- had been a real call" telephony figure instead of silently showing nothing.
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
  -- STT, USD per minute of audio. Sourced 2026-10-01 directly from each provider's own pricing
  -- page (deepgram.com/pricing, assemblyai.com/pricing, docs.fish.audio, developers.openai.com/
  -- api/docs/pricing); Cartesia publishes credits, not USD, so its figure is derived from the
  -- Startup plan's advertised $/credit and flagged accordingly.
  ('stt', 'deepgram',    'minute', 0.0077,   'Deepgram Nova-3 streaming (Nova-2 no longer listed): $0.0077/min regular, $0.0048/min promo'),
  ('stt', 'assemblyai',  'minute', 0.0025,   'AssemblyAI Universal-Streaming: $0.15/hr'),
  ('stt', 'cartesia',    'minute', 0.0024,   'Cartesia Ink-Whisper: derived from Startup plan credits (~1 credit/sec) — no flat USD rate published, plan-dependent'),
  ('stt', 'openai',      'minute', 0.006,    'OpenAI Whisper API (whisper-1): $0.006/min'),
  ('stt', 'fish',        'minute', 0.006,    'Fish Audio transcribe-1 / transcribe-1-pro: $0.36/audio hour'),
  -- TTS, USD per minute of generated speech — converted from each provider's published per-
  -- character/per-token rate at ~800 spoken characters/min (a natural-speech-rate assumption,
  -- the same role `tts_chars_per_min` plays in the older blended rate table).
  ('tts', 'fish',        'minute', 0.012,    'Fish Audio s1/s2-pro/s2.1-pro: $15/1M UTF-8 bytes (~chars for English) => ~$0.012/min at 800 chars/min'),
  ('tts', 'openai',      'minute', 0.012,    'OpenAI tts-1: $15/1M characters => ~$0.012/min at 800 chars/min. gpt-4o-mini-tts bills by audio token instead ($12/1M tokens) — this is an approximation if that model is in use'),
  ('tts', 'cartesia',    'minute', 0.03,     'Cartesia Sonic: derived from Startup plan credits (1 credit/char) — no flat USD rate published, plan-dependent'),
  -- Telephony, USD per minute
  ('telephony', 'twilio_outbound_us', 'minute', 0.013,  'Twilio US outbound voice list price, ~$0.013/min'),
  ('telephony', 'twilio_inbound_us',  'minute', 0.0085, 'Twilio US inbound voice list price, ~$0.0085/min'),
  ('telephony', 'web_estimate',       'minute', 0.013,  'Browser test call has no real carrier — estimated at the Twilio US outbound rate so the breakdown shows a realistic figure instead of nothing')
) AS r(provider_category, provider_name, unit_type, cost_per_unit_usd, notes)
ON CONFLICT (workspace_id, provider_category, provider_name, unit_type) DO NOTHING;
