/**
 * Cartesia configuration for WEBEE Native — every Cartesia choice in one place.
 *
 * Order of precedence for each value: the agent's own setting (builder) → the environment
 * variable → the default here. Defaults follow Cartesia's docs as of 2026-11 and were measured
 * live before being chosen (see the notes on each).
 *
 *   TTS  wss://api.cartesia.ai/tts/websocket   docs.cartesia.ai/api-reference/tts/websocket
 *   STT  wss://api.cartesia.ai/stt/websocket   docs.cartesia.ai/api-reference/stt/websocket
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

export { cartesiaCatalogApiVersion, cartesiaMaxBufferDelayMs } from "../engine-config.shared";

type Settings = Record<string, unknown> | null | undefined;

export const CARTESIA_ENV = {
  /** API version for live calls (TTS and STT sockets). */
  apiVersion: "CARTESIA_API_VERSION",
  ttsModel: "CARTESIA_TTS_MODEL",
  sttModel: "CARTESIA_STT_MODEL",
} as const;

function env(name: string): string {
  return String((typeof process !== "undefined" ? process.env?.[name] : undefined) ?? "").trim();
}

function setting(settings: Settings, key: string): string {
  return String((settings ?? {})[key] ?? "").trim();
}

/**
 * The API version calls are made with. 2026-08-14 is the version the API reference documents;
 * calls were on 2025-04-16. Measured: same first-audio time on both (≈70–90 ms).
 */
export const CARTESIA_API_VERSION_DEFAULT = "2026-08-14";

export function cartesiaApiVersion(): string {
  const v = env(CARTESIA_ENV.apiVersion);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : CARTESIA_API_VERSION_DEFAULT;
}

// ── Text to speech ───────────────────────────────────────────────────────────

export interface CartesiaModelOption {
  id: string;
  label: string;
  description: string;
}

/**
 * Models offered in the builder. Sonic-2 and Sonic-turbo were sunset by Cartesia after
 * 2026-10-20 (they still answer, but ignore speed); an agent that stored one keeps it until changed.
 * Measured first audio for one sentence: sonic-3.6 87 ms, sonic-3.5 83 ms, sonic-3 108 ms, sonic-2 132 ms.
 */
export const CARTESIA_TTS_MODELS: readonly CartesiaModelOption[] = [
  { id: "sonic-3.6", label: "Sonic 3.6", description: "Latest — fastest and most natural" },
  { id: "sonic-3.5", label: "Sonic 3.5", description: "Previous stable release" },
  { id: "sonic-3", label: "Sonic 3", description: "Older stable release" },
];

export const CARTESIA_TTS_DEFAULT_MODEL = "sonic-3.6";

/** A Cartesia TTS model id by shape, so a Fish or OpenAI model id is never sent to Cartesia. */
function isSonicModel(id: string): boolean {
  return /^sonic(-|$)/i.test(id);
}

/**
 * The Sonic model for a call: the agent's `cartesiaTtsModel`, else an explicit override (the
 * legacy shared `webeeTtsModel`, used only when it is a Sonic id), else CARTESIA_TTS_MODEL, else
 * the default. `webeeTtsModel` belongs to OpenAI's voices; reading it unconditionally sent
 * "gpt-4o-mini-tts" to Cartesia when an agent switched provider.
 */
export function resolveCartesiaTtsModel(settings?: Settings, override?: string | null): string {
  for (const candidate of [setting(settings, "cartesiaTtsModel"), String(override ?? "").trim(), env(CARTESIA_ENV.ttsModel)]) {
    if (candidate && isSonicModel(candidate)) return candidate;
  }
  return CARTESIA_TTS_DEFAULT_MODEL;
}

/** Cartesia's documented `generation_config` ranges. */
export const CARTESIA_SPEED_RANGE = { min: 0.6, max: 1.5 } as const;
export const CARTESIA_VOLUME_RANGE = { min: 0.5, max: 2 } as const;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * `generation_config` from the agent's voice settings (the same Speed and Volume sliders every
 * provider uses), or undefined when both are at their natural values. Measured on sonic-3.6:
 * volume 0.5 halves the peak level, speed 1.4 shortens a 3.5 s line by ~0.25 s.
 */
export function cartesiaGenerationConfig(
  settings: Settings,
): { speed?: number; volume?: number } | undefined {
  const out: { speed?: number; volume?: number } = {};
  const speed = Number((settings ?? {}).voiceSpeed);
  if (Number.isFinite(speed) && speed > 0 && speed !== 1) {
    out.speed = clamp(speed, CARTESIA_SPEED_RANGE.min, CARTESIA_SPEED_RANGE.max);
  }
  const volume = Number((settings ?? {}).volume);
  if (Number.isFinite(volume) && volume > 0 && volume !== 1) {
    out.volume = clamp(volume, CARTESIA_VOLUME_RANGE.min, CARTESIA_VOLUME_RANGE.max);
  }
  return Object.keys(out).length ? out : undefined;
}

/** The `language` field for a call: the agent's primary language subtag ("en-GB" → "en"). */
export function cartesiaLanguage(language: string | undefined | null): string {
  const primary = String(language ?? "").trim().split(/[-_]/)[0]?.toLowerCase();
  return primary && /^[a-z]{2,3}$/.test(primary) ? primary : "en";
}

// ── Speech to text ───────────────────────────────────────────────────────────

export interface CartesiaSttModelOption extends CartesiaModelOption {
  /** Languages the model transcribes; null = many (multilingual). */
  languages: readonly string[] | null;
  /** Accepts `keyterm` boosting. */
  keyterms: boolean;
}

/**
 * Ink-2 is Cartesia's current model (stable since 2026-10-13): English, French, Hindi, Japanese
 * and Spanish, with `keyterm` boosting. Ink-Whisper stays for every other language. Measured on
 * the same clip: both transcribed it correctly once "Arjav" was a keyterm (Ink-2 heard "Arja"
 * without it); Ink-2's final lands ~45 ms later after `finalize` (75 vs 30 ms).
 */
export const CARTESIA_STT_MODELS: readonly CartesiaSttModelOption[] = [
  {
    id: "ink-2",
    label: "Ink-2",
    description: "Latest — English, French, Hindi, Japanese, Spanish; boosts your keywords",
    languages: ["en", "fr", "hi", "ja", "es"],
    keyterms: true,
  },
  {
    id: "ink-whisper",
    label: "Ink-Whisper",
    description: "Older — many languages, no keyword boosting",
    languages: null,
    keyterms: false,
  },
];

export const CARTESIA_STT_DEFAULT_MODEL = "ink-2";

function sttModelOption(id: string): CartesiaSttModelOption | undefined {
  return CARTESIA_STT_MODELS.find((m) => m.id === id);
}

/**
 * The STT model for a call: the agent's `cartesiaSttModel`, else CARTESIA_STT_MODEL, else Ink-2 —
 * moved to Ink-Whisper when the chosen model does not cover the call's language.
 */
export function resolveCartesiaSttModel(settings: Settings, language?: string | null): string {
  const picked = setting(settings, "cartesiaSttModel") || env(CARTESIA_ENV.sttModel) || CARTESIA_STT_DEFAULT_MODEL;
  const option = sttModelOption(picked);
  const lang = String(language ?? "").trim().split(/[-_]/)[0]?.toLowerCase();
  if (option?.languages && lang && !option.languages.includes(lang)) return "ink-whisper";
  return picked;
}

/** Whether a model takes `keyterm` (unknown ids: no, so a new model is never sent one it refuses). */
export function cartesiaSttSupportsKeyterms(model: string): boolean {
  return sttModelOption(model)?.keyterms ?? false;
}

/** Ink-2's documented cap: up to 100 keyterms, 1,200 characters in total. */
export const CARTESIA_KEYTERM_LIMITS = { maxTerms: 100, maxChars: 1_200 } as const;

/** The keyterms to send, trimmed to Cartesia's limits in the order the builder lists them. */
export function cartesiaKeyterms(keywords: readonly string[] | undefined): string[] {
  const out: string[] = [];
  let chars = 0;
  for (const raw of keywords ?? []) {
    const term = String(raw ?? "").trim();
    if (!term || out.includes(term)) continue;
    if (out.length >= CARTESIA_KEYTERM_LIMITS.maxTerms || chars + term.length > CARTESIA_KEYTERM_LIMITS.maxChars) break;
    out.push(term);
    chars += term.length;
  }
  return out;
}
