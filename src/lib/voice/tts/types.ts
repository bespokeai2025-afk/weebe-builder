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
): AsyncGenerator<string> {
  let buf = "";

  for await (const token of textStream) {
    buf += token;

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
    }

    // Loop rather than branch: a single large delta (or text left over after a
    // sentence flush) can hold several maxChars-worth of unspoken words.
    while (buf.length >= maxChars) {
      // Search only up to maxChars, so the cut lands near the front of the
      // buffer instead of near its end.
      const lastSpace = buf.lastIndexOf(" ", maxChars);
      // No space at all means one very long word; cut hard to guarantee progress.
      const cut = lastSpace > 0 ? lastSpace : maxChars;
      const segment = buf.slice(0, cut).trim();
      if (segment) yield segment;
      buf = buf.slice(cut);
    }
  }

  const tail = buf.trim();
  if (tail) yield tail;
}
