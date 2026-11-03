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
} as const;

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
