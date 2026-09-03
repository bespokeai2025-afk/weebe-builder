/**
 * Deepgram streaming speech-to-text for WEBEE Native.
 *
 * Used when the agent sets `webeeSttProvider: "deepgram"`. TTS stays Fish.
 * Builder `boostedKeywords` go out as Deepgram `keywords=` plus post-correction.
 *
 * Deepgram closes the live socket after ~10s with no audio. Native gates STT
 * during long agent TTS (echo), so this session sends KeepAlive and reconnects
 * if the socket still dies — otherwise later caller turns transcribe empty
 * and the agent looks muted.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { WebSocket } from "ws";
import { applyKeywordBoost } from "./keyword-boost.shared";
import type { SttOpenOptions, SttProvider, SttSession } from "./types";

const DEEPGRAM_URL = "wss://api.deepgram.com/v1/listen";
const DEFAULT_MODEL = "nova-2";
/** Give up waiting for a flush rather than leaving the caller in silence. */
const FINALIZE_TIMEOUT_MS = 1_500;
const CONNECT_TIMEOUT_MS = 5_000;
/** Deepgram NET timeout is ~10s without audio — ping sooner than that. */
export const DEEPGRAM_KEEPALIVE_MS = 5_000;

interface DeepgramResult {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  from_finalize?: boolean;
  message?: string;
  description?: string;
  channel?: { alternatives?: Array<{ transcript?: string }> };
}

export function buildDeepgramListenUrl(
  options: Pick<SttOpenOptions, "sampleRate" | "language" | "keywords">,
  model: string = DEFAULT_MODEL,
): string {
  const params = new URLSearchParams({
    encoding: "linear16",
    sample_rate: String(options.sampleRate),
    channels: "1",
    model,
    interim_results: "true",
    punctuate: "true",
    smart_format: "true",
    // Our own VAD decides turn boundaries, but Deepgram's endpointing is what
    // makes it emit finals promptly instead of holding text back.
    endpointing: "300",
  });
  if (options.language) params.set("language", options.language);
  for (const keyword of options.keywords ?? []) {
    const term = String(keyword ?? "").trim();
    if (term) params.append("keywords", term);
  }
  return `${DEEPGRAM_URL}?${params.toString()}`;
}

async function connectDeepgramSocket(
  apiKey: string,
  url: string,
): Promise<WebSocket> {
  const ws = new WebSocket(url, {
    headers: { Authorization: `Token ${apiKey}` },
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

  return ws;
}

class DeepgramSttSession implements SttSession {
  private ws: WebSocket;
  private readonly apiKey: string;
  private readonly url: string;
  private readonly options: SttOpenOptions;
  /** Finalised text for the utterance in progress. */
  private segments: string[] = [];
  private latestPartial = "";
  private pendingFlush: ((text: string) => void) | null = null;
  private closed = false;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  /** True when this utterance's frames were streamed on the current socket. */
  private appendedThisUtterance = false;
  private reconnecting: Promise<void> | null = null;

  constructor(ws: WebSocket, apiKey: string, url: string, options: SttOpenOptions) {
    this.ws = ws;
    this.apiKey = apiKey;
    this.url = url;
    this.options = options;
    this.attachSocket(ws);
    this.startKeepAlive();
  }

  private attachSocket(ws: WebSocket): void {
    ws.on("message", (raw) => {
      if (this.ws !== ws) return;
      let msg: DeepgramResult;
      try {
        msg = JSON.parse(raw.toString()) as DeepgramResult;
      } catch {
        return;
      }
      if (msg.type === "Error") {
        console.error(
          `[deepgram-stt] server error: ${msg.message ?? msg.description ?? "unknown"}`,
        );
        this.resolveFlush();
        return;
      }
      if (msg.type && msg.type !== "Results") return;

      const text = (msg.channel?.alternatives?.[0]?.transcript ?? "").trim();

      if (!msg.is_final) {
        // Interim results are cumulative for the current segment, so replace.
        if (text) {
          this.latestPartial = applyKeywordBoost(text, this.options.keywords);
          this.options.onPartial?.(this.latestPartial);
        }
        return;
      }

      this.latestPartial = "";
      if (text) {
        const boosted = applyKeywordBoost(text, this.options.keywords);
        this.segments.push(boosted);
        this.options.onFinal?.(boosted);
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
      if (this.ws !== ws) return;
      console.error("[deepgram-stt] ws error:", err.message);
      this.resolveFlush();
    });
    ws.on("close", (code, reasonBuf) => {
      if (this.ws !== ws) return;
      const reason = reasonBuf?.toString?.() ?? "";
      if (!this.closed) {
        console.warn(`[deepgram-stt] ws closed code=${code} reason=${reason || "none"}`);
      }
      this.stopKeepAlive();
      this.resolveFlush();
    });
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
      try {
        this.ws.send(JSON.stringify({ type: "KeepAlive" }));
      } catch {
        /* socket already going away */
      }
    }, DEEPGRAM_KEEPALIVE_MS);
  }

  private stopKeepAlive(): void {
    if (!this.keepAliveTimer) return;
    clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }

  private socketOpen(): boolean {
    return !this.closed && this.ws.readyState === WebSocket.OPEN;
  }

  private async ensureConnected(): Promise<boolean> {
    if (this.closed) return false;
    if (this.socketOpen()) return true;
    if (this.reconnecting) {
      await this.reconnecting;
      return this.socketOpen();
    }
    this.reconnecting = (async () => {
      console.warn("[deepgram-stt] reconnecting live session");
      this.appendedThisUtterance = false;
      const next = await connectDeepgramSocket(this.apiKey, this.url);
      this.ws = next;
      this.attachSocket(next);
      this.startKeepAlive();
    })()
      .catch((err: Error) => {
        console.error(`[deepgram-stt] reconnect failed: ${err.message}`);
      })
      .finally(() => {
        this.reconnecting = null;
      });
    await this.reconnecting;
    return this.socketOpen();
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

  private sendPcm(frame: Buffer): void {
    if (!this.socketOpen() || frame.byteLength === 0) return;
    this.appendedThisUtterance = true;
    this.ws.send(frame, { binary: true });
  }

  push(frame: Buffer): void {
    if (this.closed || frame.byteLength === 0) return;
    if (!this.socketOpen()) {
      void this.ensureConnected();
      return;
    }
    this.sendPcm(frame);
  }

  /**
   * Flush whatever Deepgram has buffered.
   *
   * Frames are ignored when they were already streamed on this socket.
   * After a drop/reconnect they are sent — the live buffer is gone.
   */
  async finalizeUtterance(frames: Buffer[]): Promise<string> {
    const live = await this.ensureConnected();
    if (!live) {
      const partial = this.latestPartial;
      this.latestPartial = "";
      this.appendedThisUtterance = false;
      return applyKeywordBoost(
        [this.drain(), partial].filter(Boolean).join(" ").trim(),
        this.options.keywords,
      );
    }

    if (!this.appendedThisUtterance) {
      for (const frame of frames) this.sendPcm(frame);
    }

    const flushed = await new Promise<string>((resolve) => {
      this.pendingFlush = resolve;
      try {
        this.ws.send(JSON.stringify({ type: "Finalize" }));
      } catch {
        this.pendingFlush = null;
        resolve([this.drain(), this.latestPartial].filter(Boolean).join(" ").trim());
        return;
      }
      setTimeout(() => {
        if (this.pendingFlush !== resolve) return;
        this.pendingFlush = null;
        const partial = this.latestPartial;
        this.latestPartial = "";
        resolve([this.drain(), partial].filter(Boolean).join(" ").trim());
      }, FINALIZE_TIMEOUT_MS);
    });

    this.appendedThisUtterance = false;
    return applyKeywordBoost(flushed, this.options.keywords);
  }

  close(): void {
    this.closed = true;
    this.stopKeepAlive();
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
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
    const url = buildDeepgramListenUrl(options, this.model);
    const ws = await connectDeepgramSocket(this.apiKey, url);
    return new DeepgramSttSession(ws, this.apiKey, url, options);
  }
}
