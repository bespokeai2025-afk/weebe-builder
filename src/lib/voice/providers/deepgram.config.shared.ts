/**
 * Deepgram configuration for WEBEE Native — every Deepgram choice in one place.
 *
 * Order of precedence for each value: the agent's own setting (builder) → the environment
 * variable → the default here. Defaults follow Deepgram's docs as of 2026-11 and were measured
 * live before being chosen (see the notes on each).
 *
 *   Nova  wss://api.deepgram.com/v1/listen   developers.deepgram.com/reference/speech-to-text/listen-streaming
 *   Flux  wss://api.deepgram.com/v2/listen   developers.deepgram.com/reference/speech-to-text/listen-flux
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

type Settings = Record<string, unknown> | null | undefined;

export const DEEPGRAM_ENV = {
  sttModel: "DEEPGRAM_STT_MODEL",
  /** Nova only: silence (ms) before Deepgram finalises a segment on its own. */
  endpointingMs: "DEEPGRAM_ENDPOINTING_MS",
  /** Flux only: backstop that ends a turn this long after speech if the engine never does. */
  fluxEotTimeoutMs: "DEEPGRAM_FLUX_EOT_TIMEOUT_MS",
  /** Flux only: how long to wait for a turn to open when the engine ended one Flux had not seen start. */
  fluxTurnStartGraceMs: "DEEPGRAM_FLUX_TURN_START_GRACE_MS",
} as const;

function envNumber(name: string): number | null {
  const raw = String((typeof process !== "undefined" ? process.env?.[name] : undefined) ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function setting(settings: Settings, key: string): string {
  return String((settings ?? {})[key] ?? "").trim();
}

export type DeepgramApi = "nova" | "flux";

export interface DeepgramModelOption {
  id: string;
  label: string;
  description: string;
}

/**
 * Models offered in the builder. Measured on one clip ("it's a freehold… Arjav Virani… the EIN is
 * one two three…"), keyterms Arjav/Virani/EIN/freehold:
 *   base          "a free hold… Ar job Ver ronnie… the Ein n"     ← what sttMode "fast" used to pick
 *   nova-2        "a free hold" (names right with keywords)
 *   nova-3        all correct with keyterm; final ~360 ms after Finalize
 *   flux-general-en  all correct; EndOfTurn ~300 ms after ForceEndTurn; ~3.5× the live updates
 *
 * Flux is offered as experimental. On a full simulated call it heard "Our job" for "Arjav" and
 * "dot com." for "arjav at gmail dot com": ForceEndTurn "ends the turn on the transcribed audio so
 * far" (Deepgram's docs), and Flux trails the audio by a few hundred ms, so words still in flight
 * when the engine ends the turn are lost. Nova-3 heard every answer on the same call.
 */
export const DEEPGRAM_STT_MODELS: readonly DeepgramModelOption[] = [
  { id: "nova-3", label: "Nova-3", description: "Latest general model — accurate, boosts your keywords" },
  {
    id: "flux-general-en",
    label: "Flux (English, experimental)",
    description: "More live text while the caller speaks, but can drop the last words of longer answers",
  },
  {
    id: "flux-general-multi",
    label: "Flux (multilingual, experimental)",
    description: "Flux for 10 languages — same caveat as Flux English",
  },
  { id: "nova-3-medical", label: "Nova-3 Medical", description: "Medical vocabulary" },
  { id: "nova-2", label: "Nova-2", description: "Older — for languages Nova-3 does not cover" },
];

export const DEEPGRAM_STT_DEFAULT_MODEL = "nova-3";

/** Which socket a model runs on, by its id's shape: Flux models use /v2/listen. */
export function deepgramApiFor(model: string): DeepgramApi {
  return /^flux-/i.test(model) ? "flux" : "nova";
}

/**
 * The boosting parameter a model takes. Nova-3 and Flux accept only `keyterm` — measured: Nova-3
 * refuses `keywords` with HTTP 400 "Keywords are not supported for Nova-3. Please use `keyterm`
 * instead", so the socket never opens. Older models take `keywords`.
 */
export function deepgramBoostParam(model: string): "keyterm" | "keywords" {
  return /^(nova-3|flux-)/i.test(model) ? "keyterm" : "keywords";
}

/**
 * The STT model for a call: the agent's `deepgramSttModel`, else Nova-3 Medical for a medical
 * vocabulary, else DEEPGRAM_STT_MODEL, else Nova-3.
 *
 * `sttMode` (Retell's "Optimize for speed / accuracy") no longer picks a model: "fast" mapped to
 * Deepgram's legacy `base` model, which mis-heard most names and terms on live calls, and Nova-3
 * is both the fastest and the most accurate option here.
 */
export function resolveDeepgramSttModel(settings: Settings): string {
  const own = setting(settings, "deepgramSttModel");
  if (own) return own;
  if ((settings ?? {}).vocabSpecialization === "medical") return "nova-3-medical";
  const fromEnv = String((typeof process !== "undefined" ? process.env?.[DEEPGRAM_ENV.sttModel] : undefined) ?? "").trim();
  return fromEnv || DEEPGRAM_STT_DEFAULT_MODEL;
}

/** Nova `endpointing` (ms): the agent's `deepgramEndpointingMs`, else the env, else 300. */
export function deepgramEndpointingMs(settings: Settings): number {
  const own = Number((settings ?? {}).deepgramEndpointingMs);
  if (Number.isFinite(own) && own >= 10 && own <= 5_000) return Math.round(own);
  const fromEnv = envNumber(DEEPGRAM_ENV.endpointingMs);
  return fromEnv !== null && fromEnv >= 10 && fromEnv <= 5_000 ? Math.round(fromEnv) : 300;
}

/**
 * Flux `eot_timeout_ms`. The engine runs its own end-of-speech detection and ends each turn with
 * `ForceEndTurn` (Deepgram's "own turn detection" mode, `eot_threshold=1.0`), so this is only a
 * backstop; it is set at Deepgram's maximum so Flux never ends a turn the engine is still holding.
 */
export function deepgramFluxEotTimeoutMs(): number {
  const fromEnv = envNumber(DEEPGRAM_ENV.fluxEotTimeoutMs);
  return fromEnv !== null && fromEnv >= 500 && fromEnv <= 60_000 ? Math.round(fromEnv) : 60_000;
}

/**
 * Flux opens a turn (`StartOfTurn`) ~700 ms into speech. A short reply said straight after the
 * agent ("Yes.") can reach the engine's endpoint before that, and Flux then ignores ForceEndTurn
 * ("no turn was active") — measured on a test call, the reply came back empty and the caller had
 * to say it again (6.9 s). When the utterance carried audio, the session waits this long for the
 * turn to open and ends it then; silence-only utterances are not affected.
 */
export function deepgramFluxTurnStartGraceMs(): number {
  const fromEnv = envNumber(DEEPGRAM_ENV.fluxTurnStartGraceMs);
  return fromEnv !== null && fromEnv >= 0 && fromEnv <= 3_000 ? Math.round(fromEnv) : 700;
}

/** Deepgram's documented keyterm budget is 500 tokens; ~100 short terms stays well inside it. */
export const DEEPGRAM_KEYTERM_LIMITS = { maxTerms: 100, maxChars: 1_500 } as const;

export function deepgramKeyterms(keywords: readonly string[] | undefined): string[] {
  const out: string[] = [];
  let chars = 0;
  for (const raw of keywords ?? []) {
    const term = String(raw ?? "").trim();
    if (!term || out.includes(term)) continue;
    if (out.length >= DEEPGRAM_KEYTERM_LIMITS.maxTerms || chars + term.length > DEEPGRAM_KEYTERM_LIMITS.maxChars) break;
    out.push(term);
    chars += term.length;
  }
  return out;
}
