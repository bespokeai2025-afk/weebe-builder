/**
 * Deepgram Flux streaming speech-to-text (wss://api.deepgram.com/v2/listen) for WEBEE Native.
 *
 * Flux is Deepgram's model built for voice agents: it reports a turn as it unfolds (`TurnInfo`
 * events `StartOfTurn`, `Update`, `EndOfTurn`). The engine keeps its own end-of-speech detection,
 * so this runs in Deepgram's documented "own turn detection" mode: `eot_threshold=1.0` stops Flux
 * ending turns by itself, and the engine sends `{"type":"ForceEndTurn"}` at its endpoint, which
 * Flux answers with `EndOfTurn` (trigger "manual") carrying the turn's transcript.
 *
 * Behaviour measured live before relying on it:
 *   - ForceEndTurn → EndOfTurn ≈ 300–390 ms from India ("Yes.", "No, it's vacant.", a 9 s clip).
 *   - ForceEndTurn with no turn open (silence, noise) is answered by a `Warning` "…while no turn
 *     was active; the request was ignored". For a silent utterance the flush resolves on it. When
 *     audio was sent, the turn may simply not have opened yet (Flux opens one ~700 ms into speech),
 *     so the session waits `deepgramFluxTurnStartGraceMs` for StartOfTurn and ends it then.
 *   - No audio for 15 s (the engine withholds audio while the agent speaks) keeps the socket open.
 *     Sending Nova's `{"type":"KeepAlive"}` CLOSES it ("Could not deserialize last text message"),
 *     so this session never sends one.
 *   - `Update` text is the whole turn so far, ~every 240 ms, but lags the audio — so it is a
 *     partial, and the engine still waits for `EndOfTurn`.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { WebSocket } from "ws";
import { applyKeywordBoost } from "./keyword-boost.shared";
import {
  deepgramFluxEotTimeoutMs,
  deepgramFluxTurnStartGraceMs,
  deepgramKeyterms,
} from "../providers/deepgram.config.shared";
import type { SttOpenOptions, SttSession } from "./types";

const DEEPGRAM_FLUX_URL = "wss://api.deepgram.com/v2/listen";
/** Give up waiting for EndOfTurn rather than leaving the caller in silence. */
const FINALIZE_TIMEOUT_MS = 1_500;
const CONNECT_TIMEOUT_MS = 5_000;
/** Flux's documented raw-audio sample rates. */
const FLUX_SAMPLE_RATES = [8_000, 16_000, 24_000, 44_100, 48_000];

interface FluxMessage {
  type?: string;
  event?: string;
  transcript?: string;
  code?: string;
  description?: string;
}

export function buildDeepgramFluxUrl(
  options: Pick<SttOpenOptions, "sampleRate" | "language" | "keywords">,
  model: string,
): string {
  if (!FLUX_SAMPLE_RATES.includes(options.sampleRate)) {
    throw new Error(`Deepgram Flux does not accept ${options.sampleRate} Hz audio`);
  }
  const params = new URLSearchParams({
    model,
    encoding: "linear16",
    sample_rate: String(options.sampleRate),
    // Own turn detection: Flux never ends a turn itself; the engine's ForceEndTurn does.
    eot_threshold: "1.0",
    eot_timeout_ms: String(deepgramFluxEotTimeoutMs()),
  });
  for (const term of deepgramKeyterms(options.keywords)) params.append("keyterm", term);
  // Language hints are for the multilingual model only; Deepgram rejects them on the English one.
  const lang = String(options.language ?? "").trim().split(/[-_]/)[0]?.toLowerCase();
  if (/-multi$/i.test(model) && lang && /^[a-z]{2}$/.test(lang)) params.append("language_hint", lang);
  return `${DEEPGRAM_FLUX_URL}?${params.toString()}`;
}

async function connect(apiKey: string, url: string): Promise<WebSocket> {
  const ws = new WebSocket(url, { headers: { Authorization: `Token ${apiKey}` } });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Deepgram Flux did not connect within ${CONNECT_TIMEOUT_MS}ms`));
    }, CONNECT_TIMEOUT_MS);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
    ws.once("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      let body = "";
      res.on("data", (d: Buffer) => (body += d.toString()));
      res.on("end", () => reject(new Error(`Deepgram Flux refused the connection: HTTP ${res.statusCode} ${body.slice(0, 200)}`)));
    });
  });
  return ws;
}

export class DeepgramFluxSession implements SttSession {
  private ws: WebSocket;
  /** The open turn's text so far (from `Update`), for a flush that never gets its EndOfTurn. */
  private turnText = "";
  private pendingFlush: ((text: string) => void) | null = null;
  private closed = false;
  private reconnecting: Promise<void> | null = null;
  /** True when this utterance's frames were streamed on the current socket. */
  private appendedThisUtterance = false;
  /** A ForceEndTurn was ignored for want of an open turn: end the turn as soon as one opens. */
  private awaitingTurnStart: ReturnType<typeof setTimeout> | null = null;

  private constructor(
    ws: WebSocket,
    private readonly apiKey: string,
    private readonly url: string,
    private readonly options: SttOpenOptions,
  ) {
    this.ws = ws;
    this.attach(ws);
  }

  static async open(apiKey: string, model: string, options: SttOpenOptions): Promise<DeepgramFluxSession> {
    const url = buildDeepgramFluxUrl(options, model);
    return new DeepgramFluxSession(await connect(apiKey, url), apiKey, url, options);
  }

  private attach(ws: WebSocket): void {
    ws.on("message", (raw) => {
      if (this.ws !== ws) return;
      let msg: FluxMessage;
      try {
        msg = JSON.parse(raw.toString()) as FluxMessage;
      } catch {
        return;
      }
      if (msg.type === "TurnInfo") {
        const text = applyKeywordBoost(String(msg.transcript ?? "").trim(), this.options.keywords);
        if (msg.event === "EndOfTurn") {
          this.turnText = "";
          if (text) this.options.onFinal?.(text);
          this.settle(text);
          return;
        }
        if ((msg.event === "Update" || msg.event === "StartOfTurn") && text && text !== this.turnText) {
          this.turnText = text;
          this.options.onPartial?.(text);
        }
        // The turn the engine already ended has now opened: end it, so its EndOfTurn settles the flush.
        if (msg.event === "StartOfTurn" && this.awaitingTurnStart && this.pendingFlush) {
          this.clearTurnStartWait();
          this.sendForceEndTurn();
        }
        return;
      }
      if (msg.type === "Warning") {
        if (/no turn was active/i.test(String(msg.description ?? ""))) this.onForceEndIgnored();
        else console.warn(`[deepgram-flux] warning ${msg.code ?? ""}: ${msg.description ?? ""}`);
        return;
      }
      if (msg.type === "Error") {
        console.error(`[deepgram-flux] server error ${msg.code ?? ""}: ${msg.description ?? "unknown"}`);
        this.settle(this.takeTurnText());
      }
    });
    ws.on("error", (err: Error) => {
      if (this.ws !== ws) return;
      console.error("[deepgram-flux] ws error:", err.message);
      this.settle(this.takeTurnText());
    });
    ws.on("close", (code, reason) => {
      if (this.ws !== ws) return;
      if (!this.closed) console.warn(`[deepgram-flux] ws closed code=${code} reason=${reason?.toString() || "none"}`);
      this.settle(this.takeTurnText());
    });
  }

  /**
   * ForceEndTurn found no open turn. Over silence that means nothing was said. With audio sent,
   * the turn may not have opened yet: wait a bounded time for StartOfTurn rather than lose the reply.
   */
  private onForceEndIgnored(): void {
    if (!this.pendingFlush) return;
    const grace = deepgramFluxTurnStartGraceMs();
    if (!this.appendedThisUtterance || grace === 0 || this.awaitingTurnStart) {
      if (!this.awaitingTurnStart) this.settle(this.takeTurnText());
      return;
    }
    this.awaitingTurnStart = setTimeout(() => {
      this.awaitingTurnStart = null;
      this.settle(this.takeTurnText());
    }, grace);
  }

  private clearTurnStartWait(): void {
    if (this.awaitingTurnStart) clearTimeout(this.awaitingTurnStart);
    this.awaitingTurnStart = null;
  }

  private sendForceEndTurn(): boolean {
    try {
      this.ws.send(JSON.stringify({ type: "ForceEndTurn" }));
      return true;
    } catch {
      return false;
    }
  }

  private takeTurnText(): string {
    const text = this.turnText;
    this.turnText = "";
    return text;
  }

  private settle(text: string): void {
    this.clearTurnStartWait();
    const resolve = this.pendingFlush;
    if (!resolve) return;
    this.pendingFlush = null;
    resolve(text);
  }

  private socketOpen(): boolean {
    return !this.closed && this.ws.readyState === WebSocket.OPEN;
  }

  private async ensureConnected(): Promise<boolean> {
    if (this.closed) return false;
    if (this.socketOpen()) return true;
    if (!this.reconnecting) {
      this.reconnecting = (async () => {
        console.warn("[deepgram-flux] reconnecting live session");
        this.appendedThisUtterance = false;
        const next = await connect(this.apiKey, this.url);
        this.ws = next;
        this.attach(next);
      })()
        .catch((err: Error) => console.error(`[deepgram-flux] reconnect failed: ${err.message}`))
        .finally(() => {
          this.reconnecting = null;
        });
    }
    await this.reconnecting;
    return this.socketOpen();
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

  /** End the turn at the engine's endpoint and return its transcript. */
  async finalizeUtterance(frames: Buffer[]): Promise<string> {
    if (!(await this.ensureConnected())) return this.takeTurnText();
    // After a reconnect the live audio is gone; send the endpointed frames instead.
    if (!this.appendedThisUtterance) for (const frame of frames) this.sendPcm(frame);
    const text = await new Promise<string>((resolve) => {
      // A flush still waiting (its EndOfTurn never came) ends empty, keeping this turn's text.
      const stale = this.pendingFlush;
      this.pendingFlush = null;
      stale?.("");
      this.pendingFlush = resolve;
      if (!this.sendForceEndTurn()) {
        this.settle(this.takeTurnText());
        return;
      }
      // Long enough for a turn that opens late (see onForceEndIgnored) to end and report.
      setTimeout(() => {
        if (this.pendingFlush === resolve) this.settle(this.takeTurnText());
      }, FINALIZE_TIMEOUT_MS + deepgramFluxTurnStartGraceMs());
    });
    this.appendedThisUtterance = false;
    return text;
  }

  close(): void {
    this.closed = true;
    this.settle(this.takeTurnText());
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
