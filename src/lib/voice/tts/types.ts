/**
 * Provider-agnostic TTS contract for the WEBEE native voice engine.
 *
 * Every provider emits raw PCM16 mono at the requested sample rate so the
 * voice gateway never has to care which vendor produced the audio:
 *   - browser playback wants 24 kHz
 *   - Twilio/FreJun telephony wants 8 kHz (resampled downstream to mulaw)
 */

/** Raw PCM16 mono audio, Int16-aligned. */
export type PcmChunk = Buffer;

/**
 * Latency/quality trade-off. Names match Fish Audio's `latency` parameter;
 * providers without an equivalent knob ignore it.
 */
export type TtsLatencyMode = "low" | "normal" | "balanced";

export interface TtsVoiceRequest {
  /** Provider-specific voice id (Fish `reference_id`, ElevenLabs voice id). */
  voiceId: string;
  /** Output sample rate in Hz. */
  sampleRate: number;
  /** Provider model override; falls back to the provider default. */
  model?: string;
  latency?: TtsLatencyMode;
  /** 1.0 = natural pace. Providers clamp to their own supported range. */
  speed?: number;
}

export interface TtsProvider {
  readonly name: string;

  /** Synthesize one complete utterance. */
  synthesize(text: string, req: TtsVoiceRequest): AsyncGenerator<PcmChunk>;

  /**
   * Synthesize while the text is still being produced (LLM tokens), so the
   * first audio can play before the model has finished its sentence.
   *
   * Providers with native input streaming (Fish Audio) forward tokens as they
   * arrive. Providers without it fall back to sentence batching.
   */
  synthesizeStream(
    textStream: AsyncIterable<string>,
    req: TtsVoiceRequest,
  ): AsyncGenerator<PcmChunk>;
}

/**
 * Re-emit a PCM byte stream so every yielded buffer holds whole Int16 samples.
 *
 * HTTP/WebSocket chunk boundaries do not respect sample boundaries, so a chunk
 * can end mid-sample. Forwarding that as-is shifts every following byte by one
 * and turns the rest of the utterance into noise.
 */
export async function* alignPcm16(source: AsyncIterable<Buffer>): AsyncGenerator<PcmChunk> {
  let carry: Buffer | null = null;

  for await (const chunk of source) {
    const buf: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk;
    carry = null;

    const alignedLen = buf.byteLength - (buf.byteLength % 2);
    if (alignedLen < buf.byteLength) {
      carry = buf.subarray(alignedLen);
    }
    if (alignedLen > 0) {
      yield buf.subarray(0, alignedLen);
    }
  }
  // A trailing odd byte is an incomplete sample; dropping it is correct.
}

/**
 * Batch a token stream into speakable segments for providers that cannot accept
 * partial text. Flushes on sentence-ending punctuation, or once `maxChars`
 * accumulate so a long clause never stalls playback.
 */
export async function* batchIntoSentences(
  textStream: AsyncIterable<string>,
  maxChars = 160,
  options?: { firstFlushChars?: number },
): AsyncGenerator<string> {
  let buf = "";
  const firstFlushAt = options?.firstFlushChars ?? maxChars;
  let sentFirst = firstFlushAt >= maxChars;

  for await (const token of textStream) {
    buf += token;

    if (!sentFirst && buf.trim().length >= firstFlushAt) {
      const window = buf.slice(0, Math.min(buf.length, firstFlushAt + 8));
      const lastSpace = window.lastIndexOf(" ");
      const cut = lastSpace > 0 ? lastSpace : Math.min(buf.length, firstFlushAt);
      const segment = buf.slice(0, cut).trim();
      if (segment) {
        yield segment;
        buf = buf.slice(cut);
        sentFirst = true;
      }
    }

    // Flush at the last sentence boundary present in the buffer.
    const lastBoundary = Math.max(
      buf.lastIndexOf("."),
      buf.lastIndexOf("!"),
      buf.lastIndexOf("?"),
      buf.lastIndexOf("\n"),
    );
    if (lastBoundary >= 0) {
      const segment = buf.slice(0, lastBoundary + 1).trim();
      if (segment) yield segment;
      buf = buf.slice(lastBoundary + 1);
      sentFirst = true;
    }

    while (buf.length >= maxChars) {
      const lastSpace = buf.lastIndexOf(" ", maxChars);
      const cut = lastSpace > 0 ? lastSpace : maxChars;
      const segment = buf.slice(0, cut).trim();
      if (segment) yield segment;
      buf = buf.slice(cut);
      sentFirst = true;
    }
  }

  const tail = buf.trim();
  if (tail) yield tail;
}

/** Collapse LLM / transcript spacing artifacts before synthesis. */
export function normalizeSpeechText(text: string): string {
  return text
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/([(\[{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Sentence-sized batches for providers without native token streaming. */
export const VOICE_LATENCY_TTS_BATCH = { maxChars: 160, firstFlushChars: 12 } as const;

export async function* batchForVoiceLatency(
  textStream: AsyncIterable<string>,
): AsyncGenerator<string> {
  yield* batchIntoSentences(
    textStream,
    VOICE_LATENCY_TTS_BATCH.maxChars,
    { firstFlushChars: VOICE_LATENCY_TTS_BATCH.firstFlushChars },
  );
}

/**
 * Split pre-authored dialogue into chunks Fish can start speaking immediately.
 * Long static nodes are the common case in exported Retell flows.
 */
export function* splitSpeakableChunks(text: string, maxChars = 120): Generator<string> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const sentences = trimmed.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [trimmed];
  for (const raw of sentences) {
    let segment = raw.trim();
    while (segment.length > maxChars) {
      const cut = segment.lastIndexOf(" ", maxChars);
      const idx = cut > 0 ? cut : maxChars;
      const piece = segment.slice(0, idx).trim();
      if (piece) yield piece;
      segment = segment.slice(idx).trim();
    }
    if (segment) yield segment;
  }
}
