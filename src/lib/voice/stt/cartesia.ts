/**
 * Cartesia (Ink-Whisper) streaming speech-to-text for WEBEE Native.
 *
 * Used when the agent sets `webeeSttProvider: "cartesia"`. Model, API version and keyterms come
 * from `providers/cartesia.config.shared.ts` (Ink-2 by default; Ink-Whisper for languages Ink-2
 * does not cover). This is Cartesia's manual endpoint: the engine's own end-of-speech detection
 * decides the turn and sends `finalize`.
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
import {
  CARTESIA_STT_DEFAULT_MODEL,
  CARTESIA_STT_MODELS,
  cartesiaApiVersion,
  cartesiaKeyterms,
  cartesiaSttSupportsKeyterms,
} from "../providers/cartesia.config.shared";
import type { SttOpenOptions, SttProvider, SttSession } from "./types";

const CARTESIA_URL = "wss://api.cartesia.ai/stt/websocket";
const DEFAULT_MODEL = CARTESIA_STT_DEFAULT_MODEL;
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
  options: Pick<SttOpenOptions, "sampleRate" | "language" | "keywords">,
  model: string = DEFAULT_MODEL,
): string {
  const params = new URLSearchParams({
    model,
    encoding: "pcm_s16le",
    sample_rate: String(options.sampleRate),
    cartesia_version: cartesiaApiVersion(),
  });
  // `language` is an Ink-Whisper parameter (Ink-2 detects among its own languages); a model this
  // file does not know keeps receiving it, as every model used to.
  const known = CARTESIA_STT_MODELS.find((m) => m.id === model);
  if (options.language && (!known || known.languages === null)) params.set("language", options.language);
  if (cartesiaSttSupportsKeyterms(model)) {
    for (const term of cartesiaKeyterms(options.keywords)) params.append("keyterm", term);
  }
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
        // `finalize`/`close` has been processed: every final piece for the audio sent so far has
        // arrived (measured: always before this ack), so the flush resolves here and only here.
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
        // Kept as sent: Cartesia's docs say to join final pieces exactly, with no separator added
        // and no whitespace stripped — each piece carries its own leading space.
        const boosted = applyKeywordBoost(msg.text ?? "", this.options.keywords);
        this.segments.push(boosted);
        this.options.onFinal?.(boosted.trim());
      }
      // Not resolving the flush here: after `finalize`, Ink-2 sends the closing words in several
      // final pieces (" 6", then "789.") before `flush_done`. Resolving on the first piece cut
      // answers in two on live calls — "O77OO-90012" then "3. Yes, that's right." — and put the
      // rest at the start of the caller's next turn.
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
    const text = this.segments.join("").replace(/\s+/g, " ").trim();
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
  /**
   * Ink-whisper sends no in-progress transcripts — only a finished segment once it hears a pause,
   * measured 250 ms after the caller stopped (before the 400 ms end-of-speech wait ends). Its final
   * takes 30–80 ms, so there is nothing worth skipping, and the segments would miss whatever came
   * after the last one.
   */
  readonly capabilities = {
    partials: false,
    segmentFinalsBeforeEndpoint: true,
    partialCanReplaceFinal: false,
  } as const;

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
