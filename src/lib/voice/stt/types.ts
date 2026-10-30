/**
 * Speech-to-text — provider-agnostic contract.
 *
 * Two very different shapes hide behind this interface, which is why it looks the
 * way it does:
 *
 *   - Streaming providers (Fish realtime ASR, Deepgram Nova-2) transcribe continuously, so by the
 *     time the caller stops speaking the text is already available. Their cost is
 *     one flush round-trip, not a whole transcription.
 *   - Batch providers (Fish `/v1/asr` fallback) need a finished utterance in a
 *     container, so the entire transcription happens after end-of-speech and lands
 *     directly on the turn's latency budget.
 *
 * Callers therefore always do both: `push` every frame as it arrives, and call
 * `finalizeUtterance` with the endpointed audio. A streaming provider ignores the
 * frames it is handed; a batch provider ignores the pushes.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

export interface SttOpenOptions {
  sampleRate: number;
  /** Fired as text firms up mid-utterance. Streaming providers only. */
  onPartial?(text: string): void;
  /** Fired for each finalised segment, which may arrive before endpointing. */
  onFinal?(text: string): void;
  /** Hint for recognition quality; ignored by providers without the option. */
  language?: string;
  /** Domain words to bias recognition toward. */
  keywords?: string[];
}

export interface SttSession {
  /** Feed one PCM16 mono frame as it arrives from the caller. */
  push(frame: Buffer): void;
  /**
   * Close out the current utterance and return its transcript.
   *
   * `frames` is the endpointed audio, used by batch providers. Streaming
   * providers flush their own buffer instead and ignore it.
   */
  finalizeUtterance(frames: Buffer[]): Promise<string>;
  /** Drop buffered audio (streaming providers). Called after agent speech ends. */
  clearInputBuffer?(): void;
  /**
   * Conversation context for providers that use it (Fish realtime): the agent's lines, so short
   * replies like "the second one" are recognised in context.
   */
  addContext?(role: "user" | "assistant", text: string): void;
  close(): void;
}

/**
 * How a speech recogniser behaves while the caller talks. Each provider declares this in its own
 * file, and the voice engine reads it instead of checking provider names, so every provider gets
 * the same orchestration: whatever arrives before the endpoint starts the same pre-endpoint work
 * (speculative routing and speech, adaptive hangover), and the final is skipped only where that
 * is safe.
 */
export interface SttCapabilities {
  /** Sends in-progress transcripts while the caller is still talking. */
  partials: boolean;
  /**
   * Sends each finished segment as soon as it hears a pause — before the engine's end-of-speech
   * wait is over. With no partials, these are what the pre-endpoint work starts from.
   */
  segmentFinalsBeforeEndpoint: boolean;
  /**
   * A partial that looks complete ("yes", "it's empty") is the whole utterance, so the engine may
   * use it and skip waiting for the final. False when a partial only covers speech up to the last
   * pause: anything the caller said after it would be lost.
   */
  partialCanReplaceFinal: boolean;
}

export interface SttProvider {
  readonly name: string;
  /** True when the provider emits text while the caller is still speaking. */
  readonly streaming: boolean;
  readonly capabilities: SttCapabilities;
  open(options: SttOpenOptions): Promise<SttSession>;
}
