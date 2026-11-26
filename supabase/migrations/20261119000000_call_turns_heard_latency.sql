-- What the caller actually waits: their last word → the agent's first audio.
--
-- speech_to_first_audio_ms starts at the turn's origin, which is AFTER the end-of-speech wait
-- (400 ms by default, up to 900 ms for a half-finished sentence) and utterance coalescing
-- (~80–320 ms). The caller sits through both, so that number read ~0.5 s better than what they
-- heard. It is kept as it was, so older rows stay comparable; these two sit beside it.

alter table public.call_turns
  add column if not exists voice_end_to_first_audio_ms integer,
  add column if not exists end_of_speech_wait_ms integer;

comment on column public.call_turns.voice_end_to_first_audio_ms is
  'Caller''s last voiced audio → first agent audio sent. The number the caller hears (excludes the phone network).';
comment on column public.call_turns.end_of_speech_wait_ms is
  'Caller''s last voiced audio → turn start: the end-of-speech wait plus utterance coalescing.';

create index if not exists call_turns_heard_latency_idx
  on public.call_turns (workspace_id, is_test_call, voice_end_to_first_audio_ms)
  where voice_end_to_first_audio_ms is not null;
