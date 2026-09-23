/**
 * OpenAI speech voices and models.
 *
 * Kept apart from openai.provider.ts so the agent builder can list the voices without pulling the
 * provider implementation into the browser bundle.
 */

/** Voices /v1/audio/speech accepts. */
export const OPENAI_TTS_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
] as const;

export type OpenAiTtsVoice = (typeof OPENAI_TTS_VOICES)[number];

export const OPENAI_TTS_DEFAULT_MODEL = "gpt-4o-mini-tts";
export const OPENAI_TTS_DEFAULT_VOICE: OpenAiTtsVoice = "alloy";

export function isOpenAiTtsVoice(value: unknown): value is OpenAiTtsVoice {
  return (OPENAI_TTS_VOICES as readonly string[]).includes(
    String(value ?? "").trim().toLowerCase(),
  );
}
