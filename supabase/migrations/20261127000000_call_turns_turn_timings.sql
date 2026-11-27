-- Turn timings counted the same way as perceived / caller wait / full turn (turn-timings.shared.ts).
--   stt_to_first_speakable_ms  final transcript → first phrase handed to TTS (gates audio; its gap
--                              over first token is phrase buffering)
--   full_turn_ms               caller's last word → the agent finished speaking
--   speech_end_reference       which boundary "last word" came from: caller_speech_frame,
--                              estimated_from_silence or endpoint — never claim an exact acoustic
--                              figure when only the endpoint was known
--   llm_service_tier           OpenAI processing tier the reply was requested on (priority, …)
-- All nullable: older rows stay as they are, and the writer leaves these out until they exist.

alter table public.call_turns
  add column if not exists stt_to_first_speakable_ms integer,
  add column if not exists full_turn_ms integer,
  add column if not exists speech_end_reference text,
  add column if not exists llm_service_tier text;
