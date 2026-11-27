/**
 * One voice library across WEBEE Native's text-to-speech providers.
 *
 * Each provider publishes its voices differently (Fish: a community model catalogue with free-form
 * tags; Cartesia: a voice API with gender and accent fields; OpenAI: a fixed set of voices). The
 * voice picker shows them as one list of `LibraryVoice` rows, and this table says what each
 * provider can do — whether it can clone, which filters its data supports, and which of the
 * agent's voice settings it actually applies on a call — so the picker never offers a control
 * that silently does nothing.
 *
 * Browser-safe: no server imports.
 */
import { OPENAI_TTS_VOICES } from "./tts/openai-voices.shared";

export type VoiceLibraryProvider = "fish" | "cartesia" | "openai";
export type VoiceGender = "male" | "female" | "neutral";
export type VoiceSource = "all" | "mine";

export interface LibraryVoice {
  /** The id stored on the agent for this provider (Fish reference_id, Cartesia UUID, OpenAI name). */
  id: string;
  name: string;
  description?: string;
  gender?: VoiceGender;
  /** Accent id from `VOICE_ACCENTS`, when the provider's data says. */
  accent?: string;
  language?: string;
  tags: string[];
  /** The workspace's own clone. */
  owned: boolean;
  /** A ready-made sample the provider hosts — plays instantly and costs nothing. */
  sampleUrl?: string;
}

export interface VoiceLibraryQuery {
  provider: VoiceLibraryProvider;
  search?: string;
  gender?: VoiceGender;
  accent?: string;
  /** "en" (English voices) or "all". */
  language?: "en" | "all";
  source?: VoiceSource;
  page?: number;
}

export interface VoiceLibraryResult {
  voices: LibraryVoice[];
  hasMore: boolean;
  page: number;
}

/** Agent settings the picker's tuning panel can change. */
export type VoiceTuningKey =
  | "voiceSpeed"
  | "volume"
  | "voiceTemperature"
  | "voiceEmotion"
  | "enableDynamicVoiceSpeed"
  | "webeeTtsInstructions";

export interface VoiceProviderCaps {
  label: string;
  tagline: string;
  /** Can the workspace clone a voice from an audio sample here? */
  clone: boolean;
  /** Upload limit for a clone sample, in bytes. */
  cloneMaxBytes?: number;
  filters: { gender: boolean; accent: boolean; language: boolean; source: boolean };
  /** Settings this provider applies on WEBEE Native calls (see call-voice-profile.shared.ts). */
  tuning: VoiceTuningKey[];
  /** Shown in the tuning panel when the provider ignores the usual voice settings. */
  tuningNote?: string;
}

export const VOICE_PROVIDERS: Record<VoiceLibraryProvider, VoiceProviderCaps> = {
  fish: {
    label: "Fish Audio",
    tagline: "Large community library and instant clones",
    clone: true,
    cloneMaxBytes: 20 * 1024 * 1024,
    filters: { gender: true, accent: true, language: true, source: true },
    tuning: ["voiceSpeed", "volume", "voiceTemperature", "voiceEmotion", "enableDynamicVoiceSpeed"],
  },
  cartesia: {
    label: "Cartesia",
    tagline: "Low-latency voices with accent data, and clones",
    clone: true,
    cloneMaxBytes: 16 * 1024 * 1024,
    filters: { gender: true, accent: true, language: false, source: true },
    // Applied on calls as Cartesia `generation_config` (speed 0.6–1.5, volume 0.5–2.0) — see
    // providers/cartesia.config.shared.ts. Emotion is not offered: Cartesia's set differs.
    tuning: ["voiceSpeed", "volume"],
  },
  openai: {
    label: "OpenAI",
    tagline: "A small set of built-in voices you can direct in words",
    clone: false,
    filters: { gender: false, accent: false, language: false, source: false },
    tuning: ["voiceSpeed", "enableDynamicVoiceSpeed", "webeeTtsInstructions"],
  },
};

export const VOICE_LIBRARY_PROVIDERS = Object.keys(VOICE_PROVIDERS) as VoiceLibraryProvider[];

export function isVoiceLibraryProvider(value: unknown): value is VoiceLibraryProvider {
  return typeof value === "string" && value in VOICE_PROVIDERS;
}

/** Accents the filters offer, with how each provider's data names them. */
export const VOICE_ACCENTS = [
  { id: "american", label: "American", locale: "en-US", words: ["american", "us"] },
  { id: "british", label: "British", locale: "en-GB", words: ["british", "uk", "english accent"] },
  { id: "australian", label: "Australian", locale: "en-AU", words: ["australian", "aussie"] },
  { id: "indian", label: "Indian", locale: "en-IN", words: ["indian"] },
] as const;

export type VoiceAccentId = (typeof VOICE_ACCENTS)[number]["id"];

export function accentById(id: string | undefined) {
  return VOICE_ACCENTS.find((a) => a.id === id);
}

const MALE = /^(male|man|boy|masculine|guy)$/i;
const FEMALE = /^(female|woman|girl|feminine|lady)$/i;

/** Gender from free-form tags ("male", "Female", "woman"…), or undefined when they don't say. */
export function genderFromTags(tags: readonly string[]): VoiceGender | undefined {
  if (tags.some((t) => FEMALE.test(t.trim()))) return "female";
  if (tags.some((t) => MALE.test(t.trim()))) return "male";
  return undefined;
}

/** Accent id from tags or a locale ("en-GB"), or undefined. */
export function accentFromText(values: readonly (string | null | undefined)[]): string | undefined {
  for (const raw of values) {
    const v = String(raw ?? "")
      .trim()
      .toLowerCase();
    if (!v) continue;
    for (const accent of VOICE_ACCENTS) {
      if (
        v === accent.locale.toLowerCase() ||
        v.replace("_", "-") === accent.locale.toLowerCase()
      ) {
        return accent.id;
      }
      if (accent.words.some((w) => v === w || v.split(/[\s,/-]+/).includes(w))) return accent.id;
    }
  }
  return undefined;
}

/** OpenAI's built-in voices as library rows. */
export function openAiLibraryVoices(search?: string): LibraryVoice[] {
  const q = String(search ?? "")
    .trim()
    .toLowerCase();
  return OPENAI_TTS_VOICES.filter((v) => !q || v.includes(q)).map((v) => ({
    id: v,
    name: v.charAt(0).toUpperCase() + v.slice(1),
    tags: [],
    owned: false,
  }));
}

/** Settings patch that stores a voice choice for a provider (and makes it the agent's TTS). */
export function voiceSelectionPatch(
  provider: VoiceLibraryProvider,
  voice: Pick<LibraryVoice, "id" | "name" | "owned">,
): Record<string, unknown> {
  if (provider === "fish") {
    return {
      webeeTtsProvider: "fish",
      webeeVoiceId: voice.id,
      webeeVoiceName: voice.name,
      webeeVoiceOwned: voice.owned,
    };
  }
  if (provider === "cartesia") {
    return { webeeTtsProvider: "cartesia", cartesiaVoice: voice.id, cartesiaVoiceName: voice.name };
  }
  return { webeeTtsProvider: "openai", openaiVoice: voice.id };
}

/** The voice id the agent has stored for a provider ("" when none). */
export function storedVoiceId(
  settings: Record<string, unknown> | null | undefined,
  provider: VoiceLibraryProvider,
): string {
  const field =
    provider === "fish"
      ? "webeeVoiceId"
      : provider === "cartesia"
        ? "cartesiaVoice"
        : "openaiVoice";
  return String((settings ?? {})[field] ?? "").trim();
}

export const DEFAULT_PREVIEW_TEXT = "Hi there! How can I help you today?";
