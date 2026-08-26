/**
 * Whisper behind the streaming STT interface.
 *
 * Whisper is a batch endpoint, so this cannot produce partials. It exists so the
 * gateway has one code path regardless of which provider is configured: `push` is
 * a no-op and all the work happens in `finalizeUtterance`.
 *
 * Being on the critical path is the cost — the whole transcription lands after
 * end-of-speech — which is exactly why Deepgram is preferred when available.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { buildWav, whisperTranscribe } from "./whisper";
import type { SttOpenOptions, SttProvider, SttSession } from "./types";

class WhisperSttSession implements SttSession {
  constructor(
    private readonly apiKey: string,
    private readonly options: SttOpenOptions,
  ) {}

  /** No-op: Whisper cannot consume a live stream. */
  push(): void {}

  async finalizeUtterance(frames: Buffer[]): Promise<string> {
    if (frames.length === 0) return "";
    const text = await whisperTranscribe(
      buildWav(frames, this.options.sampleRate),
      this.apiKey,
      this.options.language,
    );
    if (text) this.options.onFinal?.(text);
    return text;
  }

  close(): void {}
}

export class WhisperSttProvider implements SttProvider {
  readonly name = "whisper";
  readonly streaming = false;

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("OpenAI API key is required for Whisper");
  }

  async open(options: SttOpenOptions): Promise<SttSession> {
    return new WhisperSttSession(this.apiKey, options);
  }
}
