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

const CARTESIA_TTS_WS = "wss://api.cartesia.ai/tts/websocket";
const CARTESIA_VERSION = "2025-04-16";
const CONNECT_TIMEOUT_MS = 10_000;

/** WEBEE Native default — Cartesia's Sonic-2 model, a well-supported stable release. */
export const CARTESIA_TTS_DEFAULT_MODEL = "sonic-2";
/** Public Cartesia sample voice ("Sarah") — used only when no voice id is configured. */
export const CARTESIA_TTS_DEFAULT_VOICE = "694f9389-aac1-45b6-b726-9d9369183238";

export function resolveCartesiaTtsModel(override?: string | null): string {
  const pick = String(override ?? process.env.CARTESIA_TTS_MODEL ?? "").trim();
  return pick || CARTESIA_TTS_DEFAULT_MODEL;
}

interface CartesiaServerMessage {
  type?: string;
  data?: string;
  done?: boolean;
  context_id?: string;
  status_code?: number;
  message?: string;
}

/** Bridges the WebSocket's message callbacks into an async generator. */
class ChunkQueue {
  private items: Buffer[] = [];
  private wake: (() => void) | null = null;
  private ended = false;
  private error: Error | null = null;

  push(chunk: Buffer): void {
    this.items.push(chunk);
    this.signal();
  }

  end(): void {
    this.ended = true;
    this.signal();
  }

  fail(err: Error): void {
    this.error ??= err;
    this.ended = true;
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

async function connectCartesiaSocket(apiKey: string): Promise<WebSocket> {
  const url = `${CARTESIA_TTS_WS}?cartesia_version=${CARTESIA_VERSION}&api_key=${encodeURIComponent(apiKey)}`;
  const ws = new WebSocket(url);
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

function attachCartesiaHandlers(ws: WebSocket, queue: ChunkQueue, contextId: string): void {
  ws.on("message", (raw) => {
    let msg: CartesiaServerMessage;
    try {
      msg = JSON.parse(raw.toString()) as CartesiaServerMessage;
    } catch {
      return;
    }
    if (msg.context_id && msg.context_id !== contextId) return;
    if (msg.type === "chunk") {
      if (msg.data) queue.push(Buffer.from(msg.data, "base64"));
      if (msg.done) queue.end();
      return;
    }
    if (msg.type === "done") {
      queue.end();
      return;
    }
    if (msg.type === "error") {
      queue.fail(new Error(`Cartesia TTS error: ${msg.message ?? `status ${msg.status_code}`}`));
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
            model_id: resolveCartesiaTtsModel(req.model ?? self.defaultModel),
            transcript: trimmed,
            voice: buildVoice(req),
            output_format: buildOutputFormat(req.sampleRate),
            language: "en",
            context_id: contextId,
          }),
        );
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

  synthesizeStream(
    textStream: AsyncIterable<string>,
    req: TtsVoiceRequest,
  ): AsyncGenerator<PcmChunk> {
    const self = this;
    return alignPcm16(
      (async function* (): AsyncGenerator<Buffer> {
        const contextId = randomUUID();
        const queue = new ChunkQueue();
        const ws = await self.takeSocket();
        attachCartesiaHandlers(ws, queue, contextId);

        const model = resolveCartesiaTtsModel(req.model ?? self.defaultModel);
        const voice = buildVoice(req);
        const outputFormat = buildOutputFormat(req.sampleRate);

        const pumpDone = (async () => {
          try {
            for await (const segment of textStream) {
              if (!segment) continue;
              if (ws.readyState !== WebSocket.OPEN) return;
              ws.send(
                JSON.stringify({
                  model_id: model,
                  transcript: segment,
                  voice,
                  output_format: outputFormat,
                  language: "en",
                  context_id: contextId,
                  continue: true,
                }),
              );
            }
            // Closes the context: a final chunk with `continue` left unset (defaults false) tells
            // Cartesia no more text is coming for this context_id, so it finalises and sends `done`.
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  model_id: model,
                  transcript: "",
                  voice,
                  output_format: outputFormat,
                  language: "en",
                  context_id: contextId,
                }),
              );
            }
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
