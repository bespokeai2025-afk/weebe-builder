-- Which model, voice and speech-to-text answered each native turn, and how big the prompt was.
-- Median first-token latency is 1.4 s on live turns against ~0.55 s measured for Cerebras
-- gpt-oss-120b; without these columns there is no way to tell which setup a slow turn ran on.
-- stt_to_llm_request_ms separates time lost before the model is asked from the model's own
-- time to first token. All nullable: older rows stay as they are.

alter table public.call_turns
  add column if not exists llm_provider text,
  add column if not exists llm_model text,
  add column if not exists tts_provider text,
  add column if not exists stt_provider text,
  add column if not exists prompt_chars integer,
  add column if not exists stt_to_llm_request_ms integer;
