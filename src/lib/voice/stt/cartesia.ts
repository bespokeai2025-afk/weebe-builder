/**
 * Cartesia (Ink-Whisper) streaming speech-to-text for WEBEE Native.
 *
 * Used when the agent sets `webeeSttProvider: "cartesia"`. TTS stays Fish by default.
 *
 * Protocol (wss://api.cartesia.ai/stt/websocket — verified live against the real API, not just
 * docs): connect with the API key in the `X-API-Key` header (server-side; browsers use an
 * `access_token` query param instead, not needed here). Audio goes out as raw binary frames at
 * the connection's `sample_rate`/`encoding`. The client's "I'm done, finalize now" signal is the
 * literal text string `"finalize"` — NOT a JSON message; sending `{"type":"finalize"}` is
 * rejected with "Expected one of: finalize, done, close". That single quirk is the one place this
 * protocol is easy to get wrong, and unlike AssemblyAI's `ForceEndpoint` (which truncates
 * in-flight recognition — see `assemblyai.ts`), Cartesia's `finalize` reliably returns the full,
 * correct transcript for whatever was actually spoken, verified directly against the live API.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { WebSocket } from "ws";
import { applyKeywordBoost } from "./keyword-boost.shared";
import type { SttOpenOptions, SttProvider, SttSession } from "./types";

const CARTESIA_URL = "wss://api.cartesia.ai/stt/websocket";
const CARTESIA_VERSION = "2025-04-16";
const DEFAULT_MODEL = "ink-whisper";
/** Give up waiting for a flush rather than leaving the caller in silence. */
const FINALIZE_TIMEOUT_MS = 3_000;
const CONNECT_TIMEOUT_MS = 5_000;
/** Cartesia's own documented idle-close window ("idle STT WebSocket connections after 3 minutes") — ping well inside it. */
export const CARTESIA_KEEPALIVE_MS = 30_000;
/** Dead-connection detection, same lesson as `assemblyai.ts`: a live-looking socket can still be a
 * zombie that silently swallows every frame. */
const PONG_TIMEOUT_MS = CARTESIA_KEEPALIVE_MS * 2 + 5_000;

interface CartesiaSttMessage {
  type?: string;
  text?: string;
  is_final?: boolean;
  message?: string;
}

export function buildCartesiaListenUrl(
  options: Pick<SttOpenOptions, "sampleRate" | "language">,
  model: string = DEFAULT_MODEL,
): string {
  const params = new URLSearchParams({
    model,
    encoding: "pcm_s16le",
    sample_rate: String(options.sampleRate),
    cartesia_version: CARTESIA_VERSION,
  });
  if (options.language) params.set("language", options.language);
  return `${CARTESIA_URL}?${params.toString()}`;
}

async function connectCartesiaSocket(apiKey: string, url: string): Promise<WebSocket> {
  const ws = new WebSocket(url, { headers: { "X-API-Key": apiKey } });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Cartesia STT did not connect within ${CONNECT_TIMEOUT_MS}ms`));
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

class CartesiaSttSession implements SttSession {
  private ws: WebSocket;
  private readonly apiKey: string;
  private readonly url: string;
  private readonly options: SttOpenOptions;
  private segments: string[] = [];
  private latestPartial = "";
  private pendingFlush: ((text: string) => void) | null = null;
  private closed = false;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastPongAt = 0;
  private reconnecting: Promise<void> | null = null;
  /** True when this utterance's frames were already streamed via `push()` on the current socket. */
  private appendedThisUtterance = false;

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
      let msg: CartesiaSttMessage;
      try {
        msg = JSON.parse(raw.toString()) as CartesiaSttMessage;
      } catch {
        return;
      }
      if (msg.type === "error") {
        console.error(`[cartesia-stt] server error: ${msg.message ?? "unknown"}`);
        this.resolveFlush();
        return;
      }
      if (msg.type === "flush_done" || msg.type === "done") {
        // Only an ack that `finalize`/`close` was processed — the transcript itself (if any)
        // arrives as its own "transcript" message, which may land before or after this one.
        this.resolveFlush();
        return;
      }
      if (msg.type !== "transcript") return;

      const text = (msg.text ?? "").trim();
      if (!msg.is_final) {
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
      if (this.pendingFlush) {
        const resolve = this.pendingFlush;
        this.pendingFlush = null;
        resolve(this.drain());
      }
    });

    ws.on("pong", () => {
      if (this.ws !== ws) return;
      this.lastPongAt = Date.now();
    });
    ws.on("error", (err: Error) => {
      if (this.ws !== ws) return;
      console.error("[cartesia-stt] ws error:", err.message);
      this.resolveFlush();
    });
    ws.on("close", (code, reasonBuf) => {
      if (this.ws !== ws) return;
      const reason = reasonBuf?.toString?.() ?? "";
      if (!this.closed) {
        console.warn(`[cartesia-stt] ws closed code=${code} reason=${reason || "none"}`);
      }
      this.stopKeepAlive();
      this.resolveFlush();
    });
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.lastPongAt = Date.now();
    this.keepAliveTimer = setInterval(() => {
      if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastPongAt > PONG_TIMEOUT_MS) {
        console.warn(`[cartesia-stt] no pong in ${PONG_TIMEOUT_MS}ms — connection is dead, forcing reconnect`);
        this.ws.terminate();
        return;
      }
      try {
        this.ws.ping();
      } catch {
        /* socket already going away */
      }
    }, CARTESIA_KEEPALIVE_MS);
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
      console.warn("[cartesia-stt] reconnecting live session");
      this.appendedThisUtterance = false;
      const next = await connectCartesiaSocket(this.apiKey, this.url);
      this.ws = next;
      this.attachSocket(next);
      this.startKeepAlive();
    })()
      .catch((err: Error) => {
        console.error(`[cartesia-stt] reconnect failed: ${err.message}`);
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
   * Flush via Cartesia's documented `finalize` text command — unlike AssemblyAI's
   * `ForceEndpoint`, this reliably returns the real transcript rather than truncating it
   * (verified directly against the live API before relying on it here).
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

    // Frames are ignored when they were already streamed live via push() on this socket. After a
    // drop/reconnect they are sent here instead — the live buffer is gone.
    if (!this.appendedThisUtterance) {
      for (const frame of frames) this.sendPcm(frame);
    }

    const flushed = await new Promise<string>((resolve) => {
      this.pendingFlush = resolve;
      try {
        this.ws.send("finalize");
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
        this.ws.send("close");
      } catch {
        /* socket already going away */
      }
    }
    this.ws.close();
  }
}

export class CartesiaSttProvider implements SttProvider {
  readonly name = "cartesia";
  readonly streaming = true;

  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_MODEL,
  ) {
    if (!apiKey) throw new Error("Cartesia API key is required");
  }

  async open(options: SttOpenOptions): Promise<SttSession> {
    const url = buildCartesiaListenUrl(options, this.model);
    const ws = await connectCartesiaSocket(this.apiKey, url);
    return new CartesiaSttSession(ws, this.apiKey, url, options);
  }
}
