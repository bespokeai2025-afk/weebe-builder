/**
 * Cartesia (Sonic) streaming text-to-speech for the WEBEE native voice engine.
 *
 * Protocol (wss://api.cartesia.ai/tts/websocket, JSON frames — verified live against the real
 * API, not just docs, since a model name or field name here being wrong fails silently mid-call):
 *   client -> { model_id, transcript, voice: { mode: "id", id }, output_format, context_id,
 *               continue?: true }   one message per text chunk, same context_id throughout
 *   server -> { type: "chunk", data: <base64 pcm>, done: bool, context_id }   repeatedly
 *   server -> { type: "done", context_id, status_code }
 *   server -> { type: "error", message, status_code }
 *
 * `context_id` is what makes input streaming possible: every message sharing one context_id is
 * synthesised as a single continuous utterance in arrival order, so LLM tokens can be pushed in as
 * they're produced instead of waiting for a complete sentence — the same role Fish's text/flush
 * events play, but over one request-shaped message instead of a start/text/flush/stop sequence.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { alignPcm16, type PcmChunk, type TtsProvider, type TtsVoiceRequest } from "./types";
import { ttsNoAudioTimeoutMs } from "../engine-config.shared";
import {
  CARTESIA_TTS_DEFAULT_MODEL,
  cartesiaApiVersion,
  cartesiaLanguage,
  cartesiaMaxBufferDelayMs,
  resolveCartesiaTtsModel as resolveFromConfig,
} from "../providers/cartesia.config.shared";
import { shouldFlushTtsPhrase } from "./phrase-chunking.shared";

const CARTESIA_TTS_WS = "wss://api.cartesia.ai/tts/websocket";
/** The API version live calls use — see `cartesiaApiVersion` in the Cartesia config. */
export const CARTESIA_VERSION = cartesiaApiVersion();
const CONNECT_TIMEOUT_MS = 10_000;

export { CARTESIA_TTS_DEFAULT_MODEL };
/** Public Cartesia sample voice ("Sarah") — used only when no voice id is configured. */
export const CARTESIA_TTS_DEFAULT_VOICE = "694f9389-aac1-45b6-b726-9d9369183238";

/** A model id for a request: `override` when it is a Sonic id, else CARTESIA_TTS_MODEL, else the default. */
export function resolveCartesiaTtsModel(override?: string | null): string {
  return resolveFromConfig(null, override);
}

interface CartesiaServerMessage {
  type?: string;
  data?: string;
  done?: boolean;
  context_id?: string;
  status_code?: number;
  message?: string;
}

/**
 * How long text may wait for audio before the synthesis is given up (engine-config.shared.ts,
 * `ttsNoAudioTimeoutMs`). Cartesia answers in ~0.2–0.5 s;
 * a socket that has stopped responding without closing (a dropped connection) used to leave the
 * reply waiting forever, and with it the whole call — nothing else is handled until a reply ends.
 */
export { ttsNoAudioTimeoutMs } from "../engine-config.shared";

/** Bridges the WebSocket's message callbacks into an async generator. */
class ChunkQueue {
  private items: Buffer[] = [];
  private wake: (() => void) | null = null;
  private ended = false;
  private error: Error | null = null;
  /** Text sent that has not produced audio yet: when it was sent. */
  private awaitingAudioSince: number | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly noAudioTimeoutMs = ttsNoAudioTimeoutMs()) {}

  /** Text was just sent: audio is now owed. */
  noteSent(): void {
    this.awaitingAudioSince ??= Date.now();
    if (this.watchdog) return;
    this.watchdog = setInterval(() => {
      if (this.ended) return this.stopWatchdog();
      const since = this.awaitingAudioSince;
      if (since !== null && Date.now() - since >= this.noAudioTimeoutMs) {
        this.fail(new Error(`Cartesia TTS: no audio within ${this.noAudioTimeoutMs}ms`));
      }
    }, 250);
  }

  private stopWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  push(chunk: Buffer): void {
    this.awaitingAudioSince = null;
    this.items.push(chunk);
    this.signal();
  }

  end(): void {
    this.ended = true;
    this.stopWatchdog();
    this.signal();
  }

  fail(err: Error): void {
    this.error ??= err;
    this.ended = true;
    this.stopWatchdog();
    this.signal();
  }

  private signal(): void {
    const w = this.wake;
    this.wake = null;
    w?.();
  }

  async *drain(): AsyncGenerator<Buffer> {
    for (;;) {
      while (this.items.length > 0) yield this.items.shift()!;
      if (this.error) throw this.error;
      if (this.ended) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}

function buildOutputFormat(sampleRate: number): Record<string, unknown> {
  return { container: "raw", encoding: "pcm_s16le", sample_rate: sampleRate };
}

function buildVoice(req: TtsVoiceRequest): Record<string, unknown> {
  const id = String(req.voiceId ?? "").trim() || CARTESIA_TTS_DEFAULT_VOICE;
  return { mode: "id", id };
}

/** The fields every message of one reply repeats (Cartesia requires them identical across a context). */
function replyFields(model: string, req: TtsVoiceRequest): Record<string, unknown> {
  return {
    model_id: model,
    voice: buildVoice(req),
    output_format: buildOutputFormat(req.sampleRate),
    language: cartesiaLanguage(req.language),
    ...(req.cartesiaGeneration ? { generation_config: req.cartesiaGeneration } : {}),
  };
}

async function connectCartesiaSocket(apiKey: string): Promise<WebSocket> {
  // The key goes in the `X-API-Key` header, as Cartesia documents for servers — not in the URL,
  // where it ends up in proxy and access logs.
  const url = `${CARTESIA_TTS_WS}?cartesia_version=${cartesiaApiVersion()}`;
  const ws = new WebSocket(url, { headers: { "X-API-Key": apiKey } });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Cartesia TTS connect timed out after ${CONNECT_TIMEOUT_MS}ms`));
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

interface CartesiaHandlerHooks {
  onAudio?: () => void;
  /** Return true when the error was handled and must not end the reply. */
  onError?: (message: string) => boolean;
}

function attachCartesiaHandlers(
  ws: WebSocket,
  queue: ChunkQueue,
  contextId: string,
  hooks: CartesiaHandlerHooks = {},
): void {
  ws.on("message", (raw) => {
    let msg: CartesiaServerMessage;
    try {
      msg = JSON.parse(raw.toString()) as CartesiaServerMessage;
    } catch {
      return;
    }
    if (msg.context_id && msg.context_id !== contextId) return;
    if (msg.type === "chunk") {
      if (msg.data) {
        hooks.onAudio?.();
        queue.push(Buffer.from(msg.data, "base64"));
      }
      if (msg.done) queue.end();
      return;
    }
    if (msg.type === "done") {
      queue.end();
      return;
    }
    if (msg.type === "error") {
      const message = msg.message ?? `status ${msg.status_code}`;
      if (hooks.onError?.(message)) return;
      queue.fail(new Error(`Cartesia TTS error: ${message}`));
      return;
    }
  });
  ws.on("error", (err: Error) => queue.fail(err));
  ws.on("close", () => queue.end());
}

/**
 * How long a pre-opened socket is trusted. Cartesia closes idle TTS sockets after a few minutes; a
 * warm socket is normally used within a second or two (opened while the caller is talking), so a
 * short limit only ever discards ones left over from an abandoned turn.
 */
const WARM_SOCKET_MAX_AGE_MS = 30_000;

/**
 * Set once Cartesia refuses `max_buffer_delay_ms` (an API version that predates it): from then on
 * this server leaves the field out rather than paying a failed first try on every reply.
 */
let bufferDelayRejected = false;

/** Test hook. */
export function resetCartesiaBufferDelayForTests(): void {
  bufferDelayRejected = false;
}

/** The `max_buffer_delay_ms` to send, or null to leave it out. */
function bufferDelayToSend(): number | null {
  return bufferDelayRejected ? null : cartesiaMaxBufferDelayMs();
}

function detachSocket(ws: WebSocket): void {
  ws.removeAllListeners();
  ws.on("error", () => {});
  ws.terminate();
}

export class CartesiaTtsProvider implements TtsProvider {
  readonly name = "cartesia";
  private readonly apiKey: string;
  private readonly defaultModel: string;
  /** One socket opened ahead of the next reply — see `warm`. */
  private warmSlot: { sock: Promise<WebSocket>; openedAt: number } | null = null;

  constructor(apiKey: string, options?: { model?: string | null }) {
    if (!apiKey) throw new Error("CartesiaTtsProvider requires an API key");
    this.apiKey = apiKey;
    this.defaultModel = resolveCartesiaTtsModel(options?.model);
  }

  /**
   * Open the next synthesis socket while the caller is still talking, so a reply does not wait on
   * the WebSocket handshake. Each reply used to open its own socket after the text was ready; the
   * voice engine calls this on speech start and on every partial, so it is a no-op while a fresh
   * socket is already waiting.
   */
  warm(): void {
    if (this.warmSlot && Date.now() - this.warmSlot.openedAt < WARM_SOCKET_MAX_AGE_MS) return;
    this.dropWarmSlot();
    const sock = connectCartesiaSocket(this.apiKey);
    // An idle socket can still error (network drop) before a reply takes it; without a listener
    // that error would be thrown on the process. Errors while in use are handled by the reply.
    sock.then((ws) => ws.on("error", () => {})).catch(() => {});
    this.warmSlot = { sock, openedAt: Date.now() };
  }

  /** The engine's call-end hook: close a socket nobody will use. */
  releaseCall(): void {
    this.dropWarmSlot();
  }

  private dropWarmSlot(): void {
    const slot = this.warmSlot;
    this.warmSlot = null;
    slot?.sock.then((ws) => ws.terminate()).catch(() => {});
  }

  /** The warm socket if it is still open and fresh, otherwise a new connection. */
  private async takeSocket(): Promise<WebSocket> {
    const slot = this.warmSlot;
    this.warmSlot = null;
    if (slot && Date.now() - slot.openedAt < WARM_SOCKET_MAX_AGE_MS) {
      try {
        const ws = await slot.sock;
        if (ws.readyState === WebSocket.OPEN) return ws;
        ws.terminate();
      } catch {
        /* the warm connect failed — connect fresh below */
      }
    } else {
      slot?.sock.then((ws) => ws.terminate()).catch(() => {});
    }
    return connectCartesiaSocket(this.apiKey);
  }

  synthesize(text: string, req: TtsVoiceRequest): AsyncGenerator<PcmChunk> {
    const trimmed = text.trim();
    const self = this;
    return alignPcm16(
      (async function* (): AsyncGenerator<Buffer> {
        if (!trimmed) return;
        const contextId = randomUUID();
        const queue = new ChunkQueue();
        const ws = await self.takeSocket();
        attachCartesiaHandlers(ws, queue, contextId);
        ws.send(
          JSON.stringify({
            ...replyFields(resolveCartesiaTtsModel(req.model ?? self.defaultModel), req),
            transcript: trimmed,
            context_id: contextId,
          }),
        );
        queue.noteSent();
        try {
          yield* queue.drain();
        } finally {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.terminate();
          }
        }
      })(),
    );
  }

  /**
   * Stream a reply as the model writes it.
   *
   * Cartesia holds streamed text until it has "enough context", for up to `max_buffer_delay_ms`
   * (3000 ms by its default). Every reply used to stream raw tokens without that field, so the
   * first phrase could sit in Cartesia's buffer for most of that time before any audio. By default
   * the reply is now cut into phrases here (the same boundaries as Fish, phrase-chunking.shared)
   * with buffering off, so the first phrase is spoken the moment it is complete. One `context_id`
   * still carries the whole reply, so the phrases are synthesised as one continuous line.
   * WEBEE_NATIVE_CARTESIA_MAX_BUFFER_DELAY_MS above 0 hands buffering back to Cartesia.
   */
  synthesizeStream(
    textStream: AsyncIterable<string>,
    req: TtsVoiceRequest,
  ): AsyncGenerator<PcmChunk> {
    const self = this;
    return alignPcm16(
      (async function* (): AsyncGenerator<Buffer> {
        const queue = new ChunkQueue();
        const fields = replyFields(resolveCartesiaTtsModel(req.model ?? self.defaultModel), req);
        let bufferDelayMs = bufferDelayToSend();
        // Decided once per reply: a fallback mid-reply keeps the phrases already cut.
        const cutPhrases = bufferDelayMs === 0;

        let ws!: WebSocket;
        let contextId = "";
        let gotAudio = false;
        let switching = false;
        /** Everything sent on this reply, so it can be replayed on a new context. */
        const sent: Array<{ transcript: string; more: boolean }> = [];

        const transmit = (transcript: string, more: boolean) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(
            JSON.stringify({
              ...fields,
              transcript,
              context_id: contextId,
              // Unset on the last message: that closes the context so Cartesia finalises and
              // sends `done`.
              ...(more ? { continue: true } : {}),
              ...(bufferDelayMs !== null ? { max_buffer_delay_ms: bufferDelayMs } : {}),
            }),
          );
          queue.noteSent();
        };
        const send = (transcript: string, more: boolean) => {
          sent.push({ transcript, more });
          if (!switching) transmit(transcript, more);
        };

        // Older API versions refuse the field. Before any audio, retry the reply on a new context
        // without it (the text so far is replayed), and stop sending it on this server.
        const fallBackWithoutBufferDelay = async () => {
          bufferDelayRejected = true;
          bufferDelayMs = null;
          switching = true;
          console.warn(
            "[cartesia-tts] max_buffer_delay_ms refused by this API version — sending replies without it " +
              "(Cartesia then buffers up to 3 s; update CARTESIA_VERSION to remove that wait)",
          );
          detachSocket(ws);
          try {
            bind(await connectCartesiaSocket(self.apiKey));
          } catch (err) {
            queue.fail(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          for (const m of sent) transmit(m.transcript, m.more);
          switching = false;
        };

        const bind = (sock: WebSocket) => {
          ws = sock;
          contextId = randomUUID();
          attachCartesiaHandlers(sock, queue, contextId, {
            onAudio: () => {
              gotAudio = true;
            },
            onError: (message) => {
              if (gotAudio || bufferDelayMs === null || !/max_buffer_delay/i.test(message)) return false;
              void fallBackWithoutBufferDelay();
              return true;
            },
          });
        };
        bind(await self.takeSocket());

        const pumpDone = (async () => {
          try {
            let buffered = "";
            let flushedOnce = false;
            for await (const segment of textStream) {
              if (!segment) continue;
              if (!switching && ws.readyState !== WebSocket.OPEN) return;
              if (!cutPhrases) {
                send(segment, true);
                continue;
              }
              buffered += segment;
              if (shouldFlushTtsPhrase(buffered, flushedOnce)) {
                send(buffered, true);
                buffered = "";
                flushedOnce = true;
              }
            }
            // The rest of the reply (or "" when nothing is left) closes the context.
            send(buffered, false);
          } catch (err) {
            queue.fail(err instanceof Error ? err : new Error(String(err)));
          }
        })();
        void pumpDone;

        try {
          yield* queue.drain();
        } finally {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.terminate();
          }
        }
      })(),
    );
  }
}
