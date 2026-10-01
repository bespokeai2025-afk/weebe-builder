/**
 * AssemblyAI Universal-Streaming speech-to-text for WEBEE Native.
 *
 * Used when the agent sets `webeeSttProvider: "assemblyai"`. TTS stays Fish.
 * Builder `boostedKeywords` go out as AssemblyAI `keyterms_prompt` plus the
 * same post-correction every other provider gets.
 *
 * v3 streaming reference (wss://streaming.assemblyai.com/v3/ws): connect with the raw API key
 * in the `Authorization` header (no "Bearer" prefix, no token-minting round trip needed for a
 * server-side client — that dance is only for browsers that would otherwise expose the key).
 * `format_turns` is left off deliberately: turning it on can emit a second, reformatted `Turn`
 * for the same `turn_order` after the first `end_of_turn`, and this codebase already normalises
 * raw STT text downstream (extraction is LLM-driven, not punctuation-sensitive), so there is
 * nothing to gain from waiting on a second message per turn.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { WebSocket } from "ws";
import { applyKeywordBoost } from "./keyword-boost.shared";
import type { SttOpenOptions, SttProvider, SttSession } from "./types";

const ASSEMBLYAI_URL = "wss://streaming.assemblyai.com/v3/ws";
const DEFAULT_MODEL = "universal-streaming-english";
/**
 * Give up waiting for a flush rather than leaving the caller in silence. Longer than Deepgram's
 * equivalent: that one forces a flush on demand, this one waits out AssemblyAI's own natural
 * end-of-turn (see `finalizeUtterance`), so it needs enough slack for that to actually land.
 */
const FINALIZE_TIMEOUT_MS = 2_500;
const CONNECT_TIMEOUT_MS = 5_000;
/** No documented idle-close window as tight as Deepgram's ~10s, but ping well inside any of them. */
export const ASSEMBLYAI_KEEPALIVE_MS = 5_000;
/**
 * How long without a pong before the socket is declared dead. Real production symptom this
 * exists for: `finalizeUtterance` timing out repeatedly (2.5s each, several in a row) with no
 * `ws error` or `ws closed` event ever firing in between — a zombie connection our own bookkeeping
 * still believed was open (`readyState === OPEN`), silently swallowing every frame sent to it. An
 * application-level JSON "KeepAlive" message doesn't surface this: AssemblyAI just ignores it
 * (verified against the live API — no error, no effect), so a one-way send succeeding proves
 * nothing about whether anything is still listening on the other end. A WebSocket ping actually
 * requires a pong back to consider the connection alive; missing one is the signal to stop
 * waiting on it and reconnect instead.
 */
const PONG_TIMEOUT_MS = ASSEMBLYAI_KEEPALIVE_MS * 2 + 2_000;

interface AssemblyAiTurnMessage {
  type?: string;
  transcript?: string;
  end_of_turn?: boolean;
  turn_is_formatted?: boolean;
  error?: string;
}

export function buildAssemblyAiListenUrl(
  options: Pick<SttOpenOptions, "sampleRate" | "keywords">,
  model: string = DEFAULT_MODEL,
): string {
  const params = new URLSearchParams({
    speech_model: model,
    sample_rate: String(options.sampleRate),
    encoding: "pcm_s16le",
  });
  const terms = (options.keywords ?? []).map((k) => String(k ?? "").trim()).filter(Boolean);
  if (terms.length > 0) params.set("keyterms_prompt", JSON.stringify(terms));
  return `${ASSEMBLYAI_URL}?${params.toString()}`;
}

async function connectAssemblyAiSocket(apiKey: string, url: string): Promise<WebSocket> {
  const ws = new WebSocket(url, {
    headers: { Authorization: apiKey },
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`AssemblyAI did not connect within ${CONNECT_TIMEOUT_MS}ms`));
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

class AssemblyAiSttSession implements SttSession {
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
  /** Last time this socket proved it was actually alive, not just `readyState === OPEN`. */
  private lastPongAt = 0;

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
      let msg: AssemblyAiTurnMessage;
      try {
        msg = JSON.parse(raw.toString()) as AssemblyAiTurnMessage;
      } catch {
        return;
      }
      if (msg.type === "Termination" || msg.type === "Begin" || msg.type === "Heartbeat") return;
      if (msg.error) {
        console.error(`[assemblyai-stt] server error: ${msg.error}`);
        this.resolveFlush();
        return;
      }
      if (msg.type !== "Turn") return;

      const text = (msg.transcript ?? "").trim();

      if (!msg.end_of_turn) {
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
      // Diagnostic only — a real end-of-turn with no text is the exact symptom behind a "catches
      // nothing" report, and there is otherwise no trace of what AssemblyAI itself actually saw.
      if (!text) {
        console.warn(
          `[assemblyai-stt] end_of_turn with empty transcript (pendingFlush=${!!this.pendingFlush})`,
        );
      }

      // A flush is satisfied by the first end-of-turn that follows it, whether or not it carried
      // text — silence must resolve the promise too.
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
      console.error("[assemblyai-stt] ws error:", err.message);
      this.resolveFlush();
    });
    ws.on("close", (code, reasonBuf) => {
      if (this.ws !== ws) return;
      const reason = reasonBuf?.toString?.() ?? "";
      if (!this.closed) {
        console.warn(`[assemblyai-stt] ws closed code=${code} reason=${reason || "none"}`);
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
        console.warn(
          `[assemblyai-stt] no pong in ${PONG_TIMEOUT_MS}ms — connection is dead, forcing reconnect`,
        );
        // terminate() over close(): a close handshake needs the remote end to cooperate, which is
        // exactly what a zombie connection won't do. This drops the socket immediately and fires
        // the "close" handler synchronously, which is what unblocks a pending finalizeUtterance
        // and lets ensureConnected's next call actually open a fresh one.
        this.ws.terminate();
        return;
      }
      try {
        this.ws.ping();
      } catch {
        /* socket already going away */
      }
    }, ASSEMBLYAI_KEEPALIVE_MS);
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
      console.warn("[assemblyai-stt] reconnecting live session");
      this.appendedThisUtterance = false;
      const next = await connectAssemblyAiSocket(this.apiKey, this.url);
      this.ws = next;
      this.attachSocket(next);
      this.startKeepAlive();
    })()
      .catch((err: Error) => {
        console.error(`[assemblyai-stt] reconnect failed: ${err.message}`);
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
   * Flush whatever AssemblyAI has buffered.
   *
   * Deliberately does NOT send `ForceEndpoint` (the documented client message for ending a turn
   * immediately) — measured against the live API, it truncates the model's in-flight
   * word-finalization pass instead of flushing it: forcing right after a short word like "yes"
   * reliably comes back with `transcript: ""`, even with several hundred ms of slack added before
   * sending it. Waiting for AssemblyAI's own natural `end_of_turn` (driven by the caller audio —
   * silence included — that `push()` is already streaming in real time) reproducibly returns the
   * correct text instead. So this just waits, bounded by `FINALIZE_TIMEOUT_MS`, the same shape
   * Deepgram's explicit `Finalize` flush uses. Frames are ignored when they were already streamed
   * on this socket. After a drop/reconnect they are sent — the live buffer is gone.
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

    // Already-finalised text sitting in `segments` (a natural end_of_turn that arrived before this
    // call) resolves immediately — nothing further to wait on.
    if (this.segments.length > 0 && !this.latestPartial) {
      this.appendedThisUtterance = false;
      return applyKeywordBoost(this.drain(), this.options.keywords);
    }

    const flushed = await new Promise<string>((resolve) => {
      this.pendingFlush = resolve;
      setTimeout(() => {
        if (this.pendingFlush !== resolve) return;
        this.pendingFlush = null;
        const partial = this.latestPartial;
        this.latestPartial = "";
        const drained = [this.drain(), partial].filter(Boolean).join(" ").trim();
        // Diagnostic only — distinguishes "AssemblyAI never sent a final in time" (this path) from
        // "it sent one and something downstream still came back empty" (the onmessage path above).
        console.warn(
          `[assemblyai-stt] finalizeUtterance timed out after ${FINALIZE_TIMEOUT_MS}ms, result="${drained}"`,
        );
        resolve(drained);
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
        this.ws.send(JSON.stringify({ type: "Terminate" }));
      } catch {
        /* socket already going away */
      }
    }
    this.ws.close();
  }
}

export class AssemblyAiSttProvider implements SttProvider {
  readonly name = "assemblyai";
  readonly streaming = true;

  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_MODEL,
  ) {
    if (!apiKey) throw new Error("AssemblyAI API key is required");
  }

  async open(options: SttOpenOptions): Promise<SttSession> {
    const url = buildAssemblyAiListenUrl(options, this.model);
    const ws = await connectAssemblyAiSocket(this.apiKey, url);
    return new AssemblyAiSttSession(ws, this.apiKey, url, options);
  }
}
