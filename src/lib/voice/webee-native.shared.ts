/**
 * WEBEE Native voice engine defaults (Fish TTS + selectable STT + graph LLM).
 */

import type { VoiceLlmProvider } from "./llm/gpt";

/** Default speech model when the provider is Cerebras. */
export const WEBEE_NATIVE_SPEECH_MODEL = "gpt-oss-120b";

/** Default speech model when the provider is OpenAI. */
export const WEBEE_NATIVE_OPENAI_SPEECH_MODEL = "gpt-4o-mini";

/** Graph edge routing + variable extraction (Cerebras). */
export const WEBEE_NATIVE_CLASSIFIER_MODEL = "gpt-oss-120b";

/** Fast OpenAI classifier for live routing. */
export const WEBEE_NATIVE_OPENAI_CLASSIFIER_MODEL = "gpt-4.1-nano";

/** Stronger classifier for nodes with many ambiguous prompt transitions. */
export const WEBEE_NATIVE_CLASSIFIER_MODEL_STRONG = "gpt-oss-120b";

export const WEBEE_NATIVE_OPENAI_CLASSIFIER_MODEL_STRONG = "gpt-4.1-mini";

/** Builder store default before WEBEE Native used its own speech default. */
const BUILDER_LEGACY_SPEECH_DEFAULT = "gpt-4.1";

export interface WebeeNativeLlmChoice {
  id: string;
  label: string;
  desc: string;
}

export const WEBEE_NATIVE_LLM_MODELS: Record<VoiceLlmProvider, WebeeNativeLlmChoice[]> = {
  openai: [
    { id: "gpt-4o-mini", label: "GPT-4o mini", desc: "Fast — best for live voice" },
    { id: "gpt-4.1-nano", label: "GPT-4.1 nano", desc: "Cheapest routing / extraction" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini", desc: "Balanced quality and speed" },
    { id: "gpt-4.1", label: "GPT-4.1", desc: "Highest OpenAI quality" },
    { id: "gpt-4o", label: "GPT-4o", desc: "Strong general model" },
  ],
  cerebras: [
    { id: "gpt-oss-120b", label: "GPT-OSS 120B", desc: "Cerebras default" },
    { id: "llama-3.3-70b", label: "Llama 3.3 70B", desc: "Cerebras Llama" },
    { id: "llama3.1-8b", label: "Llama 3.1 8B", desc: "Lowest Cerebras latency" },
    { id: "qwen-3-32b", label: "Qwen 3 32B", desc: "Cerebras Qwen" },
  ],
};

function isLegacyOpenAiVoiceModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (!id) return true;
  return (
    id.startsWith("gpt-4") ||
    id.startsWith("gpt-realtime") ||
    id.startsWith("gpt-3.5") ||
    id.includes("realtime")
  );
}

function isCerebrasModelId(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  return (
    id.startsWith("gpt-oss-") ||
    id.startsWith("llama") ||
    id.startsWith("qwen") ||
    id.startsWith("zai-")
  );
}

/** Provider chosen in the builder. Defaults to OpenAI so a dead Cerebras quota cannot freeze calls. */
export function resolveWebeeLlmProvider(
  settings?: Record<string, unknown> | null,
): VoiceLlmProvider {
  const raw = String(
    settings?.webeeLlmProvider ?? process.env.WEBEE_NATIVE_LLM_PROVIDER ?? "",
  )
    .trim()
    .toLowerCase();
  if (raw === "cerebras" || raw === "openai") return raw;
  return "openai";
}

export function resolveWebeeSpeechModel(settings?: Record<string, unknown> | null): string {
  const provider = resolveWebeeLlmProvider(settings);
  const explicit = String(settings?.webeeSpeechModel ?? "").trim();
  const inherited = String(settings?.model ?? settings?.openai_model ?? "").trim();
  if (provider === "openai") {
    if (explicit) return explicit;
    if (!inherited || isCerebrasModelId(inherited) || inherited === BUILDER_LEGACY_SPEECH_DEFAULT) {
      return WEBEE_NATIVE_OPENAI_SPEECH_MODEL;
    }
    return inherited;
  }
  if (explicit && !isLegacyOpenAiVoiceModel(explicit)) return explicit;
  if (!inherited || isLegacyOpenAiVoiceModel(inherited)) return WEBEE_NATIVE_SPEECH_MODEL;
  return inherited;
}

/**
 * Classifier model for graph routing / extraction.
 */
export function resolveWebeeClassifierModel(settings?: Record<string, unknown> | null): string {
  const provider = resolveWebeeLlmProvider(settings);
  const fromSettings = String(
    settings?.webeeClassifierModel ?? settings?.classifier_model ?? "",
  ).trim();
  if (provider === "openai") {
    if (fromSettings && !isCerebrasModelId(fromSettings)) return fromSettings;
    return WEBEE_NATIVE_OPENAI_CLASSIFIER_MODEL;
  }
  if (fromSettings && !isLegacyOpenAiVoiceModel(fromSettings)) return fromSettings;
  const fromEnv = String(process.env.WEBEE_NATIVE_CLASSIFIER_MODEL ?? "").trim();
  if (fromEnv && !isLegacyOpenAiVoiceModel(fromEnv)) return fromEnv;
  return WEBEE_NATIVE_CLASSIFIER_MODEL;
}

/**
 * Strong classifier for complex qualification / multi-branch nodes.
 */
export function resolveWebeeStrongClassifierModel(
  settings?: Record<string, unknown> | null,
): string {
  const provider = resolveWebeeLlmProvider(settings);
  const fromSettings = String(
    settings?.webeeStrongClassifierModel ??
      settings?.strong_classifier_model ??
      settings?.webee_classifier_model_strong ??
      "",
  ).trim();
  if (provider === "openai") {
    if (fromSettings && !isCerebrasModelId(fromSettings)) return fromSettings;
    return WEBEE_NATIVE_OPENAI_CLASSIFIER_MODEL_STRONG;
  }
  if (fromSettings && !isLegacyOpenAiVoiceModel(fromSettings)) return fromSettings;
  const fromEnv = String(process.env.WEBEE_NATIVE_STRONG_CLASSIFIER_MODEL ?? "").trim();
  if (fromEnv && !isLegacyOpenAiVoiceModel(fromEnv)) return fromEnv;
  return WEBEE_NATIVE_CLASSIFIER_MODEL_STRONG;
}

export function defaultModelForProvider(provider: VoiceLlmProvider): string {
  return provider === "openai" ? WEBEE_NATIVE_OPENAI_SPEECH_MODEL : WEBEE_NATIVE_SPEECH_MODEL;
}
