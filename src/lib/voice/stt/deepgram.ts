/**
 * Deepgram streaming speech-to-text.
 *
 * This is the piece that makes a sub-second turnaround possible. With batch
 * Whisper, transcription starts only after the caller stops talking, so the whole
 * transcription sits on the turn's latency budget. Deepgram transcribes as the
 * audio arrives, so at end-of-speech the text is already there and only a flush
 * round-trip remains.
 *
 * Fish Audio realtime ASR is account-gated and cannot be relied on, which is why
 * STT is behind an interface with this as the fast path.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { WebSocket } from "ws";
import type { SttOpenOptions, SttProvider, SttSession } from "./types";

const DEEPGRAM_URL = "wss://api.deepgram.com/v1/listen";
const DEFAULT_MODEL = "nova-2";
/** Give up waiting for a flush rather than leaving the caller in silence. */
const FINALIZE_TIMEOUT_MS = 1_500;
const CONNECT_TIMEOUT_MS = 5_000;

interface DeepgramResult {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  from_finalize?: boolean;
  channel?: { alternatives?: Array<{ transcript?: string }> };
}

class DeepgramSttSession implements SttSession {
  private readonly ws: WebSocket;
  /** Finalised text for the utterance in progress. */
  private segments: string[] = [];
  private latestPartial = "";
  private pendingFlush: ((text: string) => void) | null = null;
  private closed = false;

  constructor(ws: WebSocket, options: SttOpenOptions) {
    this.ws = ws;

    ws.on("message", (raw) => {
      let msg: DeepgramResult;
      try {
        msg = JSON.parse(raw.toString()) as DeepgramResult;
      } catch {
        return;
      }
      if (msg.type && msg.type !== "Results") return;

      const text = (msg.channel?.alternatives?.[0]?.transcript ?? "").trim();

      if (!msg.is_final) {
        // Interim results are cumulative for the current segment, so replace.
        if (text) {
          this.latestPartial = text;
          options.onPartial?.(text);
        }
        return;
      }

      this.latestPartial = "";
      if (text) {
        this.segments.push(text);
        options.onFinal?.(text);
      }

      // A flush is satisfied by the first final that follows it, whether or not
      // it carried text — silence must resolve the promise too.
      if (this.pendingFlush) {
        const resolve = this.pendingFlush;
        this.pendingFlush = null;
        resolve(this.drain());
      }
    });

    ws.on("error", (err: Error) => {
      console.error("[deepgram-stt] ws error:", err.message);
      this.resolveFlush();
    });
    ws.on("close", () => {
      this.closed = true;
      this.resolveFlush();
    });
  }

  private drain(): string {
    const text = this.segments.join(" ").trim();
    this.segments = [];
    return text;
  }

  /** Release a waiting flush with whatever text exists, on error or close. */
  private resolveFlush(): void {
    if (!this.pendingFlush) return;
    const resolve = this.pendingFlush;
    this.pendingFlush = null;
    resolve(this.drain());
  }

  push(frame: Buffer): void {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
    // Deepgram expects raw audio as binary frames.
    this.ws.send(frame, { binary: true });
  }

  /**
   * Flush whatever Deepgram has buffered.
   *
   * The endpointed frames are ignored: the audio was already streamed, and
   * re-sending it would duplicate the utterance.
   */
  async finalizeUtterance(_frames: Buffer[]): Promise<string> {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) {
      const partial = this.latestPartial;
      this.latestPartial = "";
      return [this.drain(), partial].filter(Boolean).join(" ").trim();
    }

    const flushed = await new Promise<string>((resolve) => {
      this.pendingFlush = resolve;
      this.ws.send(JSON.stringify({ type: "Finalize" }));
      setTimeout(() => {
        if (this.pendingFlush !== resolve) return;
        this.pendingFlush = null;
        // Fall back to the last interim text: a slightly rough transcript beats
        // dropping the caller's turn entirely.
        const partial = this.latestPartial;
        this.latestPartial = "";
        resolve([this.drain(), partial].filter(Boolean).join(" ").trim());
      }, FINALIZE_TIMEOUT_MS);
    });

    return flushed;
  }

  close(): void {
    this.closed = true;
    if (this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: "CloseStream" }));
      } catch {
        /* socket already going away */
      }
    }
    this.ws.close();
  }
}

export class DeepgramSttProvider implements SttProvider {
  readonly name = "deepgram";
  readonly streaming = true;

  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_MODEL,
  ) {
    if (!apiKey) throw new Error("Deepgram API key is required");
  }

  async open(options: SttOpenOptions): Promise<SttSession> {
    const params = new URLSearchParams({
      encoding: "linear16",
      sample_rate: String(options.sampleRate),
      channels: "1",
      model: this.model,
      interim_results: "true",
      punctuate: "true",
      smart_format: "true",
      // Our own VAD decides turn boundaries, but Deepgram's endpointing is what
      // makes it emit finals promptly instead of holding text back.
      endpointing: "300",
    });
    if (options.language) params.set("language", options.language);
    for (const keyword of options.keywords ?? []) params.append("keywords", keyword);

    const ws = new WebSocket(`${DEEPGRAM_URL}?${params.toString()}`, {
      headers: { Authorization: `Token ${this.apiKey}` },
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`Deepgram did not connect within ${CONNECT_TIMEOUT_MS}ms`));
      }, CONNECT_TIMEOUT_MS);
      ws.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once("error", (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    return new DeepgramSttSession(ws, options);
  }
}
