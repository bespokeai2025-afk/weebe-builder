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
 * falls back to s2.1-pro server-side when omitted or unrecognised.
 *
 * We always request `format: "pcm"` with an explicit `sample_rate` because the
 * pcm default is 44.1 kHz, while the voice gateway works in 24 kHz (browser)
 * or 8 kHz (telephony).
 */
import { WebSocket } from "ws";
import { decode, encode } from "@msgpack/msgpack";
import { alignPcm16, type PcmChunk, type TtsProvider, type TtsVoiceRequest } from "./types";

const FISH_TTS_WS = "wss://api.fish.audio/v1/tts/live";
const DEFAULT_MODEL = "s2.1-pro";
const CONNECT_TIMEOUT_MS = 10_000;

/** Models that accept the `model` connection header. */
const KNOWN_MODELS = new Set(["s1", "s2-pro", "s2.1-pro", "s2.1-pro-free"]);

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

async function* streamFishAudio(
  textStream: AsyncIterable<string>,
  req: TtsVoiceRequest,
  apiKey: string,
): AsyncGenerator<Buffer> {
  const model = req.model && KNOWN_MODELS.has(req.model) ? req.model : DEFAULT_MODEL;
  const queue = new ChunkQueue();

  const ws = new WebSocket(FISH_TTS_WS, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      model,
    },
  });

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

  await waitForOpen(ws);

  // Handshake listeners are one-shot; attach the long-lived ones now so a
  // mid-stream failure surfaces to the consumer instead of hanging.
  ws.on("error", (err: Error) => queue.fail(err));
  ws.on("close", () => queue.end());

  ws.send(encode({ event: "start", request: buildStartRequest(req) }));

  // Pump text concurrently with draining audio — that overlap is the whole
  // point of the WebSocket path.
  void (async () => {
    try {
      for await (const chunk of textStream) {
        if (!chunk) continue;
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(encode({ event: "text", text: chunk }));
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(encode({ event: "stop" }));
      }
    } catch (err) {
      queue.fail(err instanceof Error ? err : new Error(String(err)));
      if (ws.readyState === WebSocket.OPEN) ws.close();
    }
  })();

  try {
    yield* queue.drain();
  } finally {
    // Consumer stopped early (barge-in): tear the session down immediately.
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.terminate();
    }
  }
}

export class FishAudioTtsProvider implements TtsProvider {
  readonly name = "fish";

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("FishAudioTtsProvider requires an API key");
  }

  synthesize(text: string, req: TtsVoiceRequest): AsyncGenerator<PcmChunk> {
    async function* single(): AsyncGenerator<string> {
      yield text;
    }
    return this.synthesizeStream(single(), req);
  }

  synthesizeStream(
    textStream: AsyncIterable<string>,
    req: TtsVoiceRequest,
  ): AsyncGenerator<PcmChunk> {
    return alignPcm16(streamFishAudio(textStream, req, this.apiKey));
  }
}
