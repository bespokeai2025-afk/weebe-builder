/**
 * Fish Audio streaming TTS provider.
 *
 * Protocol (wss://api.fish.audio/v1/tts/live, MessagePack frames):
 *   client -> { event: "start", request: {...} }   once, first message
 *   client -> { event: "text",  text: "..." }      per text chunk
 *   client -> { event: "flush" }                   force synthesis of buffered text
 *   client -> { event: "stop" }                    end of stream
 *   server -> { event: "audio", audio: <bytes> }   repeatedly
 *   server -> { event: "finish", reason: "stop" | "error" }
 *
 * Headers: Authorization: Bearer <key>, and an optional `model` header which
 * defaults to s2.1-pro-free (override via FISH_TTS_MODEL or per-request `model`).
 *
 * We always request `format: "pcm"` with an explicit `sample_rate` because the
 * pcm default is 44.1 kHz, while the voice gateway works in 24 kHz (browser)
 * or 8 kHz (telephony).
 */
import { WebSocket } from "ws";
import { decode, encode } from "@msgpack/msgpack";
import { alignPcm16, type PcmChunk, type TtsProvider, type TtsVoiceRequest } from "./types";

const FISH_TTS_WS = "wss://api.fish.audio/v1/tts/live";
const CONNECT_TIMEOUT_MS = 10_000;

/** Models that accept the `model` connection header. */
const KNOWN_MODELS = new Set(["s1", "s2-pro", "s2.1-pro", "s2.1-pro-free"]);

/** WEBEE Native default — Fish S2.1 Pro free tier (same model, fair-use API). */
export const FISH_TTS_DEFAULT_MODEL = "s2.1-pro-free";

/** Resolve TTS model: per-request → FISH_TTS_MODEL env → s2.1-pro-free. */
export function resolveFishTtsModel(override?: string | null): string {
  const pick = String(override ?? process.env.FISH_TTS_MODEL ?? FISH_TTS_DEFAULT_MODEL).trim();
  return KNOWN_MODELS.has(pick) ? pick : FISH_TTS_DEFAULT_MODEL;
}

/**
 * Bridges the WebSocket's event callbacks into an async generator.
 *
 * Chunks that arrive before the consumer asks for them are buffered, so audio
 * is never dropped when synthesis outruns playback.
 */
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
      while (this.items.length > 0) {
        yield this.items.shift()!;
      }
      // Surface errors only after buffered audio has been delivered.
      if (this.error) throw this.error;
      if (this.ended) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}

interface FishServerEvent {
  event?: string;
  audio?: Uint8Array;
  reason?: string;
  message?: string;
}

interface FishLiveSession {
  ws: WebSocket;
  queue: ChunkQueue;
  close(): void;
}

function buildStartRequest(req: TtsVoiceRequest): Record<string, unknown> {
  const request: Record<string, unknown> = {
    // Text is streamed via TextEvent; StartEvent carries configuration only.
    text: "",
    format: "pcm",
    sample_rate: req.sampleRate,
    latency: req.latency ?? "low",
  };
  if (req.voiceId) request.reference_id = req.voiceId;
  if (typeof req.speed === "number") request.prosody = { speed: req.speed };
  return request;
}

function resolveModel(req: TtsVoiceRequest, defaultModel: string): string {
  const pick = req.model?.trim() || defaultModel;
  return KNOWN_MODELS.has(pick) ? pick : FISH_TTS_DEFAULT_MODEL;
}

function sessionKey(req: TtsVoiceRequest, defaultModel: string): string {
  return `${req.voiceId}:${req.sampleRate}:${resolveModel(req, defaultModel)}`;
}

async function waitForOpen(ws: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Fish Audio TTS connect timed out after ${CONNECT_TIMEOUT_MS}ms`));
      ws.terminate();
    }, CONNECT_TIMEOUT_MS);

    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
    // A server that rejects the upgrade (bad key, wrong model) closes without "open".
    ws.once("close", (code, reasonBuf) => {
      clearTimeout(timer);
      const reason = reasonBuf?.toString?.() ?? "";
      reject(new Error(`Fish Audio TTS closed during handshake: ${code} ${reason}`));
    });
  });
}

function attachFishHandlers(ws: WebSocket, queue: ChunkQueue): void {
  ws.on("message", (data: import("ws").RawData) => {
    try {
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
      const msg = decode(buf) as FishServerEvent;

      if (msg.event === "audio" && msg.audio) {
        queue.push(Buffer.from(msg.audio));
        return;
      }
      if (msg.event === "finish") {
        if (msg.reason === "error") {
          queue.fail(
            new Error(`Fish Audio TTS synthesis failed: ${msg.message ?? "unknown error"}`),
          );
        } else {
          queue.end();
        }
        ws.close();
      }
      // Unknown events are ignored so future protocol additions are non-breaking.
    } catch (err) {
      queue.fail(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

async function connectFishSession(
  req: TtsVoiceRequest,
  apiKey: string,
  defaultModel: string,
): Promise<FishLiveSession> {
  const model = resolveModel(req, defaultModel);
  const queue = new ChunkQueue();
  const ws = new WebSocket(FISH_TTS_WS, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      model,
    },
  });

  attachFishHandlers(ws, queue);
  await waitForOpen(ws);

  ws.on("error", (err: Error) => queue.fail(err));
  ws.on("close", () => queue.end());
  ws.send(encode({ event: "start", request: buildStartRequest(req) }));

  return {
    ws,
    queue,
    close() {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    },
  };
}

async function pumpFishText(
  session: FishLiveSession,
  textStream: AsyncIterable<string>,
): Promise<void> {
  try {
    for await (const chunk of textStream) {
      if (!chunk) continue;
      if (session.ws.readyState !== WebSocket.OPEN) return;
      session.ws.send(encode({ event: "text", text: chunk }));
    }
    if (session.ws.readyState === WebSocket.OPEN) {
      // One flush per utterance — Retell-style continuous speech, not per-token segments.
      session.ws.send(encode({ event: "flush" }));
      session.ws.send(encode({ event: "stop" }));
    }
  } catch (err) {
    session.queue.fail(err instanceof Error ? err : new Error(String(err)));
    session.close();
  }
}

async function* streamFishAudio(
  textStream: AsyncIterable<string>,
  req: TtsVoiceRequest,
  apiKey: string,
  takeSession: () => Promise<FishLiveSession>,
): AsyncGenerator<Buffer> {
  const session = await takeSession();
  void pumpFishText(session, textStream);

  try {
    yield* session.queue.drain();
  } finally {
    session.close();
  }
}

export class FishAudioTtsProvider implements TtsProvider {
  readonly name = "fish";
  private readonly apiKey: string;
  private readonly defaultModel: string;
  /** Open WebSocket warmed while the caller is still speaking. */
  private warmSlot: { key: string; session: Promise<FishLiveSession> } | null = null;
  /** Session already synthesizing a predicted static line (speculative warm). */
  private primedSlot: { key: string; text: string; session: Promise<FishLiveSession> } | null =
    null;

  constructor(apiKey: string, options?: { model?: string | null }) {
    if (!apiKey) throw new Error("FishAudioTtsProvider requires an API key");
    this.apiKey = apiKey;
    this.defaultModel = resolveFishTtsModel(options?.model);
  }

  /** Pre-open the next synthesis session so the first audio chunk arrives sooner. */
  warm(req: TtsVoiceRequest): void {
    const key = sessionKey(req, this.defaultModel);
    if (this.warmSlot?.key === key) return;
    this.primedSlot?.session.then((s) => s.close()).catch(() => {});
    this.primedSlot = null;
    this.warmSlot = {
      key,
      session: connectFishSession(req, this.apiKey, this.defaultModel),
    };
  }

  /**
   * Start synthesizing a predicted static line before routing finishes.
   * When `synthesize` is called with the same text, audio is reused.
   */
  warmWithText(text: string, req: TtsVoiceRequest): void {
    const trimmed = text.trim();
    if (!trimmed) {
      this.warm(req);
      return;
    }
    const key = sessionKey(req, this.defaultModel);
    if (this.primedSlot?.key === key && this.primedSlot.text === trimmed) return;

    this.warmSlot = null;
    this.primedSlot?.session.then((s) => s.close()).catch(() => {});
    this.primedSlot = {
      key,
      text: trimmed,
      session: (async () => {
        const session = await connectFishSession(req, this.apiKey, this.defaultModel);
        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(encode({ event: "text", text: trimmed }));
          session.ws.send(encode({ event: "flush" }));
        }
        return session;
      })(),
    };
  }

  private async takeSession(
    req: TtsVoiceRequest,
    expectedText?: string,
  ): Promise<{ session: FishLiveSession; primed: boolean }> {
    const key = sessionKey(req, this.defaultModel);
    const trimmed = expectedText?.trim();

    if (trimmed && this.primedSlot?.key === key && this.primedSlot.text === trimmed) {
      const slot = this.primedSlot;
      this.primedSlot = null;
      try {
        return { session: await slot.session, primed: true };
      } catch {
        return { session: await connectFishSession(req, this.apiKey, this.defaultModel), primed: false };
      }
    }

    if (this.primedSlot?.key === key) {
      this.primedSlot.session.then((s) => s.close()).catch(() => {});
      this.primedSlot = null;
    }

    if (this.warmSlot?.key === key) {
      const slot = this.warmSlot;
      this.warmSlot = null;
      try {
        return { session: await slot.session, primed: false };
      } catch {
        return { session: await connectFishSession(req, this.apiKey, this.defaultModel), primed: false };
      }
    }
    return { session: await connectFishSession(req, this.apiKey, this.defaultModel), primed: false };
  }

  synthesize(text: string, req: TtsVoiceRequest): AsyncGenerator<PcmChunk> {
    const trimmed = text.trim();
    const self = this;
    return alignPcm16(
      (async function* (): AsyncGenerator<Buffer> {
        const { session, primed } = await self.takeSession(req, trimmed);

        if (primed) {
          try {
            yield* session.queue.drain();
          } finally {
            if (session.ws.readyState === WebSocket.OPEN) {
              session.ws.send(encode({ event: "stop" }));
            }
            session.close();
          }
          return;
        }

        async function* single(): AsyncGenerator<string> {
          yield text;
        }
        void pumpFishText(session, single());
        try {
          yield* session.queue.drain();
        } finally {
          session.close();
        }
      })(),
    );
  }

  synthesizeStream(
    textStream: AsyncIterable<string>,
    req: TtsVoiceRequest,
  ): AsyncGenerator<PcmChunk> {
    const takeSession = async () => (await this.takeSession(req)).session;
    return alignPcm16(streamFishAudio(textStream, req, this.apiKey, takeSession));
  }
}
