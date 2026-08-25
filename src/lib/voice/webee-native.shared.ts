/**
 * WEBEE Native voice engine defaults (Fish STT/TTS + graph LLM).
 */

/** Default OpenAI model for graph speech on WEBEE Native calls. */
export const WEBEE_NATIVE_SPEECH_MODEL = "gpt-4o-mini";

/** Builder store default before WEBEE Native used its own speech default. */
const BUILDER_LEGACY_SPEECH_DEFAULT = "gpt-4.1";

/**
 * Speech model for WEBEE Native graph + flat mode.
 * Honors an explicit non-legacy choice; otherwise uses gpt-4o-mini for latency.
 */
export function resolveWebeeSpeechModel(settings?: Record<string, unknown> | null): string {
  const configured = String(settings?.model ?? settings?.openai_model ?? "").trim();
  if (!configured || configured === BUILDER_LEGACY_SPEECH_DEFAULT) {
    return WEBEE_NATIVE_SPEECH_MODEL;
  }
  return configured;
}
