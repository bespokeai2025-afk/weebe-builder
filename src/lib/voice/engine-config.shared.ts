/**
 * WEBEE Native engine tunables — one place, each with a documented default and an environment
 * override, so behaviour can be changed per deployment without code changes.
 *
 * Per-agent choices (model, voice, providers, end-of-speech wait, timezone) belong in the agent's
 * builder settings, not here. These are engine-wide limits and timings.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

function envNumber(name: string, fallback: number): number {
  const raw = typeof process !== "undefined" ? process.env?.[name] : undefined;
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const ENGINE_CONFIG_ENV = {
  speechFirstWordTimeoutMs: "WEBEE_NATIVE_SPEECH_FIRST_WORD_TIMEOUT_MS",
  speechHedgeInitialDelayMs: "WEBEE_NATIVE_SPEECH_HEDGE_INITIAL_MS",
  speechHedgeMaxDelayMs: "WEBEE_NATIVE_SPEECH_HEDGE_MAX_MS",
  ttsNoAudioTimeoutMs: "WEBEE_NATIVE_TTS_NO_AUDIO_TIMEOUT_MS",
  maxDetailReasks: "WEBEE_NATIVE_MAX_DETAIL_REASKS",
  identifierExtractionWaitMs: "WEBEE_NATIVE_IDENTIFIER_EXTRACTION_WAIT_MS",
  toolArgsWaitMs: "WEBEE_NATIVE_TOOL_ARGS_WAIT_MS",
  cartesiaMaxBufferDelayMs: "WEBEE_NATIVE_CARTESIA_MAX_BUFFER_DELAY_MS",
  cartesiaCatalogApiVersion: "WEBEE_CARTESIA_CATALOG_API_VERSION",
  speechPromptWarmup: "WEBEE_NATIVE_LLM_WARMUP",
} as const;

/**
 * Whether a call opens its speech model's connection and prompt cache while the greeting plays.
 * On unless the env var says off/false/0/no.
 */
export function speechPromptWarmupEnabled(): boolean {
  const raw = typeof process !== "undefined" ? process.env?.[ENGINE_CONFIG_ENV.speechPromptWarmup] : undefined;
  return !/^(off|false|0|no)$/i.test(String(raw ?? "").trim());
}

/**
 * Longest a spoken reply may wait for its model's first word before the step's fallback line is
 * spoken. Normal first words are 0.5–4.5 s; a stalled provider used to hold the call ~27 s.
 */
export function speechFirstWordTimeoutMs(): number {
  return envNumber(ENGINE_CONFIG_ENV.speechFirstWordTimeoutMs, 8_000);
}

/** Duplicate-request delay for a spoken reply before the server has learned the model's median. */
export function speechHedgeInitialDelayMs(): number {
  return envNumber(ENGINE_CONFIG_ENV.speechHedgeInitialDelayMs, 1_500);
}

/** Never send the duplicate later than this; past it the duplicate cannot help. */
export function speechHedgeMaxDelayMs(): number {
  return envNumber(ENGINE_CONFIG_ENV.speechHedgeMaxDelayMs, 2_000);
}

/** How long text sent to a streaming TTS may wait for audio before the synthesis is abandoned. */
export function ttsNoAudioTimeoutMs(): number {
  return envNumber(ENGINE_CONFIG_ENV.ttsNoAudioTimeoutMs, 8_000);
}

/**
 * Times an extract step sends the caller back for missing details before the call moves on
 * without them. A node can set its own `max_detail_reasks`.
 */
export function maxDetailReasks(nodeOverride?: unknown): number {
  const n = Number(nodeOverride);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return Math.floor(envNumber(ENGINE_CONFIG_ENV.maxDetailReasks, 3));
}

/**
 * How long a reply that carries an email or phone number waits for this turn's extraction before
 * the turn goes on (so the agent can read the new value back). Exits that test variables always
 * wait in full; this only bounds the courtesy wait, which cost 3–4 s per such reply uncapped.
 */
export function identifierExtractionWaitMs(): number {
  return envNumber(ENGINE_CONFIG_ENV.identifierExtractionWaitMs, 1_500);
}

/**
 * How long a function step waits for the model to work out its tool's arguments when every
 * required argument is already known from the call. Past it the tool runs with the known values.
 */
export function toolArgsWaitMs(): number {
  return envNumber(ENGINE_CONFIG_ENV.toolArgsWaitMs, 1_200);
}

/**
 * Cartesia's `max_buffer_delay_ms` for a streamed reply. 0 (the default) means the engine cuts the
 * reply into phrases itself and Cartesia speaks each one as soon as it arrives. 1–5000 hands
 * buffering to Cartesia instead: tokens are streamed as they come and Cartesia waits up to that
 * long for "enough context". Cartesia's own default is 3000 ms, which is what every streamed reply
 * used to wait under when the field was not sent.
 */
export function cartesiaMaxBufferDelayMs(): number {
  const raw = typeof process !== "undefined" ? process.env?.[ENGINE_CONFIG_ENV.cartesiaMaxBufferDelayMs] : undefined;
  const text = String(raw ?? "").trim();
  if (!text) return 0;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? Math.min(5_000, Math.round(n)) : 0;
}

/**
 * `Cartesia-Version` for the voice library and voice cloning (not calls, which stay on the version
 * their streaming code was tested against). 2026-08-14 is the version Cartesia's API reference
 * documents, and the one that returns preview samples, accents and the gender filter. If Cartesia
 * refuses it, the library retries on the calls' version without those extras.
 */
export function cartesiaCatalogApiVersion(): string {
  const raw = typeof process !== "undefined" ? process.env?.[ENGINE_CONFIG_ENV.cartesiaCatalogApiVersion] : undefined;
  const text = String(raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "2026-08-14";
}
