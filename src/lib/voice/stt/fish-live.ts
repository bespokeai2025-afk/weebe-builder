/**
 * Fish Audio realtime speech-to-text — the native streaming endpoint.
 *
 * `wss://api.fish.audio/v1/asr/realtime`, model `transcribe-stream-1` (released 14 Oct 2026). Unlike
 * the OpenAI-compatible socket in fish.ts, it transcribes continuously: drafts of the turn so far
 * arrive while the caller is still speaking, keyword hints (`context.terms`) are used, and the
 * agent's own lines can be given as context. Protocol: one MessagePack map per binary frame.
 *
 * Turn detection runs in `manual` mode, so the cascade's own endpointing still decides when the
 * caller has finished and `finalizeUtterance` sends `finalize`. Measured from a Mac on synthesised
 * speech: drafts held the whole sentence by the time speech ended (5 of 6 clips), and the final
 * came back 0.37–0.41 s after `finalize` (one 0.67 s) — the same overall time as the old socket's
 * speculative re-commits, without re-sending audio. Fish's own semantic end-of-turn (`auto` mode,
 * an eager signal ~0.7 s after speech stops) is the next step once real calls are measured.
 *
 * Observed behaviour the code relies on: a turn exists only once Fish hears speech
 * (`speech_start`); `finalize` with no open turn gets no reply.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { WebSocket } from "ws";
import { decode, encode } from "@msgpack/msgpack";
import { applyKeywordBoost } from "./keyword-boost.shared";
import { cleanFishTranscript, fishBatchFallback, preferEnglishLatinTranscript } from "./fish";
import type { SttOpenOptions, SttSession } from "./types";

const FISH_LIVE_ASR_URL = "wss://api.fish.audio/v1/asr/realtime";
export const FISH_LIVE_ASR_MODEL = "transcribe-stream-1";
const CONNECT_TIMEOUT_MS = 8_000;
/** How long a final may take after `finalize` before the batch endpoint is used instead. */
const FINALIZE_TIMEOUT_MS = 2_000;
/**
 * Our VAD can call end-of-speech a moment before Fish has reported `speech_start` for the same
 * audio. Wait this long for the turn to open before deciding Fish heard no speech at all.
 */
const TURN_OPEN_GRACE_MS = 250;
/** Fish recommends 80–100 ms of audio per message; the cascade delivers smaller frames. */
const SEND_CHUNK_MS = 80;
/** Fish closes a session after 30 s without a client message. */
const KEEPALIVE_AFTER_MS = 10_000;
const SUPPORTED_SAMPLE_RATES = new Set([8000, 12000, 16000, 22050, 24000, 32000, 44100, 48000]);
const MAX_TERMS = 100;
const MAX_TERM_CHARS = 32;
const MAX_CONTEXT_CHARS = 2_000;
/** A failing reconnect (bad key, Fish down) is retried no more often than this. */
const RECONNECT_BACKOFF_MS = 2_000;

type FishLiveMessage = {
  type?: string;
  turn_index?: number;
  text?: string;
  reason?: string;
  user_turn?: boolean;
  error_type?: string;
  message?: string;
  recoverable?: boolean;
};

/** Speaker markers and sound tags ("[laughter]", "[pause]") are not words the caller said. */
export function cleanFishLiveText(text: string): string {
  return cleanFishTranscript(text.replace(/\[[a-z][a-z _-]{0,30}\]/gi, " "));
}

/** Keyword hints in the shape Fish accepts: at most 100, each at most 32 characters. */
export function fishLiveTerms(keywords: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of keywords ?? []) {
    const term = String(raw ?? "").trim();
    if (!term || term.length > MAX_TERM_CHARS || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    out.push(term);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

type Waiter = { turn: number; resolve: (text: string | null) => void };

export class FishLiveSttSession implements SttSession {
  private ws: WebSocket | null = null;
  private ready = false;
  private closed = false;
  private reconnecting = false;
  private lastReconnectAt = 0;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private lastSentAt = Date.now();
  private keepalive: ReturnType<typeof setInterval> | null = null;

  /** Turn Fish has opened (heard speech in) and not yet committed. */
  private openTurn: number | null = null;
  /** Turns dropped by `clearInputBuffer`; their drafts and transcripts are ignored. */
  private readonly discarded = new Set<number>();
  /** Text Fish committed on its own (turn over 60 s), carried into the next final. */
  private carried: string[] = [];
  private latestDraft = "";
  private finalWaiter: Waiter | null = null;
  private turnOpenWaiters: Array<() => void> = [];

  private constructor(
    private readonly apiKey: string,
    private readonly options: SttOpenOptions,
    private readonly url: string,
  ) {}

  /** `url` is for tests; calls always use Fish's endpoint. */
  static async connect(
    apiKey: string,
    options: SttOpenOptions,
    url: string = FISH_LIVE_ASR_URL,
  ): Promise<FishLiveSttSession> {
    if (!SUPPORTED_SAMPLE_RATES.has(options.sampleRate)) {
      throw new Error(`Fish realtime ASR does not accept ${options.sampleRate} Hz`);
    }
    const session = new FishLiveSttSession(apiKey, options, url);
    await session.open();
    session.keepalive = setInterval(() => session.sendKeepalive(), KEEPALIVE_AFTER_MS);
    return session;
  }

  private open(): Promise<void> {
    const ws = new WebSocket(this.url, {
      headers: { Authorization: `Bearer ${this.apiKey}`, model: FISH_LIVE_ASR_MODEL },
    });
    // Late errors after a failed connect must not crash the process.
    ws.on("error", () => {});

    return new Promise<void>((resolve, reject) => {
      const fail = (err: Error) => {
        clearTimeout(timer);
        ws.terminate();
        reject(err);
      };
      const timer = setTimeout(
        () => fail(new Error(`Fish realtime ASR did not start within ${CONNECT_TIMEOUT_MS}ms`)),
        CONNECT_TIMEOUT_MS,
      );

      ws.once("open", () => {
        const terms = fishLiveTerms(this.options.keywords);
        ws.send(
          encode({
            type: "config",
            audio: { format: "pcm_s16le", sample_rate: this.options.sampleRate, channels: 1 },
            turn_detection: { mode: "manual" },
            results: { drafts: true, ignore_timestamps: true, diarize: false },
            ...(terms.length ? { context: { terms } } : {}),
          }),
        );
        this.lastSentAt = Date.now();
      });

      ws.on("message", (raw) => {
        let msg: FishLiveMessage;
        try {
          msg = decode(raw as Buffer) as FishLiveMessage;
        } catch {
          return;
        }
        if (msg.type === "session_started") {
          clearTimeout(timer);
          this.ws = ws;
          this.ready = true;
          resolve();
          return;
        }
        if (msg.type === "error" && !this.ready) {
          fail(new Error(`Fish realtime ASR refused the session: ${msg.error_type} ${msg.message ?? ""}`));
          return;
        }
        this.onMessage(msg);
      });

      ws.once("close", () => {
        clearTimeout(timer);
        if (!this.ready) {
          reject(new Error("Fish realtime ASR closed before the session started"));
          return;
        }
        this.onSocketClosed(ws);
      });
    });
  }

  private onMessage(msg: FishLiveMessage): void {
    switch (msg.type) {
      case "speech_start":
      case "draft": {
        const turn = Number(msg.turn_index);
        if (!Number.isFinite(turn) || this.discarded.has(turn)) return;
        if (this.openTurn !== turn) {
          this.openTurn = turn;
          const waiters = this.turnOpenWaiters;
          this.turnOpenWaiters = [];
          for (const w of waiters) w();
        }
        if (msg.type === "draft") {
          const text = applyKeywordBoost(cleanFishLiveText(String(msg.text ?? "")), this.options.keywords);
          if (!text) return;
          this.latestDraft = text;
          const full = [...this.carried, text].join(" ");
          try {
            this.options.onPartial?.(full);
          } catch (err) {
            // Runs inside the socket's message handler — a throw here would crash the process.
            console.error("[fish-live-stt] partial handler failed:", (err as Error).message);
          }
        }
        return;
      }

      case "committed": {
        const turn = Number(msg.turn_index);
        if (this.openTurn === turn) this.openTurn = null;
        if (this.discarded.delete(turn)) return;
        const text = applyKeywordBoost(cleanFishLiveText(String(msg.text ?? "")), this.options.keywords);
        if (this.finalWaiter && this.finalWaiter.turn === turn) {
          const waiter = this.finalWaiter;
          this.finalWaiter = null;
          waiter.resolve(text);
          return;
        }
        // Fish ended the turn itself (60 s limit): keep the words for the caller's final.
        if (text) this.carried.push(text);
        return;
      }

      case "error":
        console.error(
          `[fish-live-stt] ${msg.error_type ?? "error"}: ${msg.message ?? ""}${msg.recoverable ? " (recoverable)" : ""}`,
        );
        return;

      default:
        return;
    }
  }

  private onSocketClosed(ws: WebSocket): void {
    if (this.ws !== ws) return;
    this.ws = null;
    this.ready = false;
    this.openTurn = null;
    this.finalWaiter?.resolve(null);
    this.finalWaiter = null;
    if (this.closed) return;
    // Server restart or the 60-minute session limit. Reconnect in the background; until then
    // finals use the batch endpoint with the endpointed audio.
    console.warn("[fish-live-stt] socket closed mid-call — reconnecting");
    this.reconnect();
  }

  private reconnect(): void {
    if (this.reconnecting || this.closed) return;
    if (Date.now() - this.lastReconnectAt < RECONNECT_BACKOFF_MS) return;
    this.lastReconnectAt = Date.now();
    this.reconnecting = true;
    void this.open()
      .catch((err) => console.error("[fish-live-stt] reconnect failed:", (err as Error).message))
      .finally(() => {
        this.reconnecting = false;
      });
  }

  private send(msg: Record<string, unknown>): boolean {
    const ws = this.ws;
    if (!ws || !this.ready || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(encode(msg));
    this.lastSentAt = Date.now();
    return true;
  }

  private sendKeepalive(): void {
    if (Date.now() - this.lastSentAt >= KEEPALIVE_AFTER_MS) this.send({ type: "keepalive" });
  }

  private flushAudio(): void {
    if (this.pendingBytes === 0) return;
    const data = Buffer.concat(this.pending);
    this.pending = [];
    this.pendingBytes = 0;
    this.send({ type: "audio", data });
  }

  push(frame: Buffer): void {
    if (this.closed || frame.byteLength === 0) return;
    if (!this.ws) {
      this.reconnect();
      return;
    }
    this.pending.push(frame);
    this.pendingBytes += frame.byteLength;
    const chunkBytes = Math.floor((SEND_CHUNK_MS / 1000) * this.options.sampleRate) * 2;
    if (this.pendingBytes >= chunkBytes) this.flushAudio();
  }

  /** The agent's line, so short replies ("the second one") are heard in context. */
  addContext(role: "user" | "assistant", text: string): void {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_CONTEXT_CHARS);
    if (clean) this.send({ type: "context_add", items: [{ role, text: clean }] });
  }

  clearInputBuffer(): void {
    this.pending = [];
    this.pendingBytes = 0;
    this.carried = [];
    this.latestDraft = "";
    if (this.openTurn !== null) {
      this.discarded.add(this.openTurn);
      this.openTurn = null;
      this.send({ type: "finalize" });
    }
  }

  private waitForTurnOpen(ms: number): Promise<void> {
    if (this.openTurn !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.turnOpenWaiters.push(done);
    });
  }

  async finalizeUtterance(frames: Buffer[]): Promise<string> {
    const carried = this.carried;
    const draft = this.latestDraft;
    this.carried = [];
    this.latestDraft = "";

    if (this.closed || !this.ws) {
      this.pending = [];
      this.pendingBytes = 0;
      const batch = await fishBatchFallback(this.apiKey, this.options, frames);
      return preferEnglishLatinTranscript(this.apiKey, this.options, batch, frames, draft);
    }

    this.flushAudio();
    if (this.openTurn === null) await this.waitForTurnOpen(TURN_OPEN_GRACE_MS);
    const turn = this.openTurn;

    let text: string | null = null;
    if (turn !== null) {
      text = await new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => {
          if (this.finalWaiter?.turn === turn) this.finalWaiter = null;
          resolve(null);
        }, FINALIZE_TIMEOUT_MS);
        this.finalWaiter = {
          turn,
          resolve: (t) => {
            clearTimeout(timer);
            resolve(t);
          },
        };
        if (!this.send({ type: "finalize" })) {
          this.finalWaiter = null;
          clearTimeout(timer);
          resolve(null);
        }
      });
    } else if (!carried.length) {
      // Fish heard no speech in this audio: noise or echo, not words.
      return "";
    }

    if (text === null && turn === null) {
      // Only text Fish committed by itself (a turn over 60 s); nothing more to wait for.
      text = "";
    } else if (text === null) {
      // No answer in time (or the socket went away): last draft, else the batch endpoint.
      if (turn !== null) this.discarded.add(turn);
      if (this.openTurn === turn) this.openTurn = null;
      text = draft || (await fishBatchFallback(this.apiKey, this.options, frames));
    }

    const full = [...carried, text].filter(Boolean).join(" ").trim();
    return preferEnglishLatinTranscript(this.apiKey, this.options, full, frames, draft);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.keepalive) clearInterval(this.keepalive);
    this.finalWaiter?.resolve(null);
    this.finalWaiter = null;
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(encode({ type: "audio_done" }));
      } catch {
        /* closing anyway */
      }
      ws.close();
    } else if (ws) {
      ws.terminate();
    }
  }
}
