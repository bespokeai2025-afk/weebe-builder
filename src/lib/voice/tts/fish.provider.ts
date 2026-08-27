/**
 * Fish Audio streaming TTS provider.
 *
 * Protocol (wss://api.fish.audio/v1/tts/live, MessagePack frames):
 *   client -> { event: "start", request: {...} }   once per TCP connection
 *   client -> { event: "text",  text: "..." }      per text chunk
 *   client -> { event: "flush" }                   force synthesis of buffered text
 *   client -> { event: "stop" }                    end of stream
 *   server -> { event: "audio", audio: <bytes> }   repeatedly
 *   server -> { event: "finish", reason: "stop" | "error" }
 *
 * Call-bound mode: voice id + prosody are locked, and after the first successful
 * line we attach that line's audio as a Fish `references` clip so later WebSockets
 * clone the same in-call timbre (Fish resamples `reference_id` on every new TCP).
 */
import { WebSocket } from "ws";
import { decode, encode } from "@msgpack/msgpack";
import {
  alignPcm16,
  splitSpeakableChunks,
  type PcmChunk,
  type TtsProvider,
  type TtsVoiceRequest,
} from "./types";

const FISH_TTS_WS = "wss://api.fish.audio/v1/tts/live";
const CONNECT_TIMEOUT_MS = 10_000;
/** Nucleus sampling — lower keeps clone timbre from jumping between utterances. */
const FISH_CLONE_TOP_P = 0.5;
/** Target Fish chunk size. 200 is Fish's default — smaller than 300 so first audio starts sooner. */
const FISH_CLONE_CHUNK_LENGTH = 200;
/** Don't emit a fragment shorter than a word; 80 blocked first-audio by a full clause. */
const FISH_CLONE_MIN_CHUNK_LENGTH = 40;
/** First live flush once we have a speakable phrase — matches VOICE_LATENCY_TTS_BATCH. */
export const FISH_STREAM_FIRST_FLUSH_CHARS = 12;
/** Keep enough of the greeting to lock timbre; cap payload size. */
const ANCHOR_MAX_SECONDS = 3;
const ANCHOR_MIN_SECONDS = 1.2;

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
  /** True after `{ event: "stop" }` — only then may a finish frame end the queue. */
  stopSent: boolean;
  close(): void;
}

interface FishVoiceAnchor {
  wav: Buffer;
  text: string;
}

export function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, pcm]);
}

export function buildStartRequest(
  req: TtsVoiceRequest,
  anchor?: FishVoiceAnchor | null,
): Record<string, unknown> {
  const voiceId = String(req.voiceId ?? "").trim();
  if (!voiceId) {
    throw new Error("Fish TTS start request missing reference_id (voice not locked for this call)");
  }
  const request: Record<string, unknown> = {
    text: "",
    format: "pcm",
    sample_rate: req.sampleRate,
    // Fish documents `balanced` (~300ms) and `normal` (~500ms) for live TTS.
    latency: req.latency ?? "balanced",
    reference_id: voiceId,
    condition_on_previous_chunks: true,
    normalize: true,
    top_p: FISH_CLONE_TOP_P,
    chunk_length: FISH_CLONE_CHUNK_LENGTH,
    min_chunk_length: FISH_CLONE_MIN_CHUNK_LENGTH,
  };
  if (anchor?.wav.byteLength && anchor.text.trim() && req.cloneVoice) {
    request.references = [
      {
        audio: new Uint8Array(anchor.wav),
        text: anchor.text.trim(),
      },
    ];
  }
  const prosody: Record<string, unknown> = {};
  if (typeof req.speed === "number") prosody.speed = req.speed;
  if (typeof req.volume === "number") prosody.volume = req.volume;
  prosody.normalize_loudness = true;
  request.prosody = prosody;
  if (typeof req.temperature === "number") request.temperature = req.temperature;
  return request;
}

function resolveModel(req: TtsVoiceRequest, defaultModel: string): string {
  const pick = req.model?.trim() || defaultModel;
  return KNOWN_MODELS.has(pick) ? pick : FISH_TTS_DEFAULT_MODEL;
}

function sessionKey(req: TtsVoiceRequest, defaultModel: string): string {
  const t = typeof req.temperature === "number" ? req.temperature.toFixed(2) : "";
  const s = typeof req.speed === "number" ? req.speed.toFixed(2) : "";
  const v = typeof req.volume === "number" ? req.volume.toFixed(1) : "";
  return `${req.voiceId}:${req.sampleRate}:${resolveModel(req, defaultModel)}:${t}:${s}:${v}`;
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
    ws.once("close", (code, reasonBuf) => {
      clearTimeout(timer);
      const reason = reasonBuf?.toString?.() ?? "";
      reject(new Error(`Fish Audio TTS closed during handshake: ${code} ${reason}`));
    });
  });
}

function attachFishHandlers(session: FishLiveSession): void {
  const { ws, queue } = session;
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
        } else if (session.stopSent) {
          queue.end();
        }
      }
    } catch (err) {
      queue.fail(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

async function connectFishSession(
  req: TtsVoiceRequest,
  apiKey: string,
  defaultModel: string,
  anchor?: FishVoiceAnchor | null,
): Promise<FishLiveSession> {
  try {
    return await openFishSession(req, apiKey, defaultModel, anchor);
  } catch (err) {
    if (!anchor) throw err;
    console.warn(
      `[fish-tts] connect with voice anchor failed, retrying without: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return openFishSession(req, apiKey, defaultModel, null);
  }
}

async function openFishSession(
  req: TtsVoiceRequest,
  apiKey: string,
  defaultModel: string,
  anchor?: FishVoiceAnchor | null,
): Promise<FishLiveSession> {
  const model = resolveModel(req, defaultModel);
  const queue = new ChunkQueue();
  const ws = new WebSocket(FISH_TTS_WS, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      model,
    },
  });

  const session: FishLiveSession = {
    ws,
    queue,
    stopSent: false,
    close() {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    },
  };

  attachFishHandlers(session);
  await waitForOpen(ws);

  ws.on("error", (err: Error) => queue.fail(err));
  ws.on("close", () => queue.end());
  ws.send(encode({ event: "start", request: buildStartRequest(req, anchor) }));

  return session;
}

/**
 * When to flush the Fish live buffer so first audio can start before the
 * full sentence exists. Later flushes stay on sentence boundaries.
 */
export function shouldFlushFishLiveBuffer(
  buffered: string,
  alreadyFlushed: boolean,
): boolean {
  const ready = buffered.trim();
  if (!ready) return false;
  if (!alreadyFlushed) {
    if (ready.length >= FISH_STREAM_FIRST_FLUSH_CHARS) return true;
    if (ready.length >= 8 && /[.!?,;:]["']?\s*$/.test(ready)) return true;
    if (ready.length >= 12 && /\s$/.test(buffered)) return true;
    return false;
  }
  return /[.!?]["']?\s*$/.test(ready) && ready.length >= 24;
}

interface PumpOptions {
  /** When false, keep the TCP session open for the next agent line (call-bound mode). */
  sendStop?: boolean;
}

function endFishPump(session: FishLiveSession, sendStop: boolean): void {
  if (session.ws.readyState !== WebSocket.OPEN) {
    session.queue.fail(new Error("Fish Audio TTS socket closed before stop"));
    return;
  }
  session.ws.send(encode({ event: "flush" }));
  if (!sendStop) return;
  session.stopSent = true;
  session.ws.send(encode({ event: "stop" }));
}

async function pumpFishText(
  session: FishLiveSession,
  textStream: AsyncIterable<string>,
  options: PumpOptions = {},
): Promise<void> {
  const sendStop = options.sendStop !== false;
  try {
    let buffered = "";
    let flushed = false;
    for await (const segment of textStream) {
      if (!segment) continue;
      if (session.ws.readyState !== WebSocket.OPEN) {
        session.queue.fail(new Error("Fish Audio TTS socket closed during synthesis"));
        return;
      }
      buffered += segment;
      session.ws.send(encode({ event: "text", text: segment }));
      if (shouldFlushFishLiveBuffer(buffered, flushed)) {
        session.ws.send(encode({ event: "flush" }));
        flushed = true;
        buffered = "";
      }
    }
    endFishPump(session, sendStop);
  } catch (err) {
    session.queue.fail(err instanceof Error ? err : new Error(String(err)));
    session.close();
  }
}

async function pumpFishStaticChunks(
  session: FishLiveSession,
  text: string,
  options: PumpOptions = {},
): Promise<void> {
  const sendStop = options.sendStop !== false;
  try {
    if (session.ws.readyState !== WebSocket.OPEN) {
      session.queue.fail(new Error("Fish Audio TTS socket closed during synthesis"));
      return;
    }
    // One text + one flush: splitting/flushing every sentence resamples the clone mid-line.
    session.ws.send(encode({ event: "text", text }));
    endFishPump(session, sendStop);
  } catch (err) {
    session.queue.fail(err instanceof Error ? err : new Error(String(err)));
    session.close();
  }
}

/**
 * Serializes agent lines; each utterance is a full Fish start→text→stop session
 * with the same locked reference_id + prosody (Fish closes TCP after finish).
 */
class BoundCallUtteranceRunner {
  private utteranceChain: Promise<void> = Promise.resolve();
  private warmSession: Promise<FishLiveSession> | null = null;
  /** Socket already synthesizing a predicted static line. */
  private primed: { text: string; session: Promise<FishLiveSession> } | null = null;
  /** First in-call agent audio — later lines clone this instead of resampling the model. */
  private anchor: FishVoiceAnchor | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly defaultModel: string,
    private readonly req: TtsVoiceRequest,
  ) {}

  close(): void {
    this.warmSession?.then((session) => session.close()).catch(() => {});
    this.primed?.session.then((session) => session.close()).catch(() => {});
    this.warmSession = null;
    this.primed = null;
    this.anchor = null;
  }

  warm(): void {
    if (this.warmSession || this.primed) return;
    this.warmSession = connectFishSession(this.req, this.apiKey, this.defaultModel, this.anchor);
  }

  /** Start synthesizing a predicted static line while the caller is still talking. */
  warmWithText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) {
      this.warm();
      return;
    }
    if (this.primed?.text === trimmed) return;

    this.primed?.session.then((session) => session.close()).catch(() => {});
    const pending = this.warmSession;
    this.warmSession = null;
    this.primed = {
      text: trimmed,
      session: (async () => {
        const session = await (pending ?? connectFishSession(this.req, this.apiKey, this.defaultModel, this.anchor));
        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(encode({ event: "text", text: trimmed }));
          session.ws.send(encode({ event: "flush" }));
        }
        return session;
      })(),
    };
  }

  private maybeSetAnchor(pcm: Buffer, spokenText: string): void {
    if (this.anchor || !this.req.cloneVoice) return;
    const bytesPerSecond = this.req.sampleRate * 2;
    const minBytes = Math.floor(ANCHOR_MIN_SECONDS * bytesPerSecond);
    if (pcm.byteLength < minBytes) return;
    const maxBytes = Math.floor(ANCHOR_MAX_SECONDS * bytesPerSecond);
    const clip = pcm.byteLength > maxBytes ? pcm.subarray(0, maxBytes) : pcm;
    const text = spokenText.trim();
    if (!text) return;
    this.anchor = { wav: pcm16ToWav(clip, this.req.sampleRate), text };
    console.log(
      `[fish-tts] call voice anchor set reference_id=${this.req.voiceId}` +
        ` wav_bytes=${this.anchor.wav.byteLength} text_chars=${text.length}`,
    );
  }

  private async takeSession(
    expectedText?: string,
  ): Promise<{ session: FishLiveSession; primed: boolean }> {
    const want = expectedText?.trim();
    if (want && this.primed?.text === want) {
      const slot = this.primed;
      this.primed = null;
      try {
        return { session: await slot.session, primed: true };
      } catch {
        return {
          session: await connectFishSession(this.req, this.apiKey, this.defaultModel, this.anchor),
          primed: false,
        };
      }
    }

    if (this.primed) {
      this.primed.session.then((s) => s.close()).catch(() => {});
      this.primed = null;
    }

    if (this.warmSession) {
      const pending = this.warmSession;
      this.warmSession = null;
      try {
        return { session: await pending, primed: false };
      } catch {
        return {
          session: await connectFishSession(this.req, this.apiKey, this.defaultModel, this.anchor),
          primed: false,
        };
      }
    }
    const model = resolveModel(this.req, this.defaultModel);
    console.log(
      `[fish-tts] utterance reference_id=${this.req.voiceId} model=${model}` +
        ` sample_rate=${this.req.sampleRate}` +
        (typeof this.req.temperature === "number"
          ? ` temp=${this.req.temperature.toFixed(2)}`
          : "") +
        (typeof this.req.speed === "number" ? ` speed=${this.req.speed}` : "") +
        (this.anchor ? " anchor=on" : " anchor=off"),
    );
    return {
      session: await connectFishSession(this.req, this.apiKey, this.defaultModel, this.anchor),
      primed: false,
    };
  }

  async *runUtterance(
    pump: (session: FishLiveSession) => Promise<void>,
    spokenText: () => string,
    expectedText?: string,
  ): AsyncGenerator<Buffer> {
    let release!: () => void;
    const slot = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prior = this.utteranceChain;
    this.utteranceChain = prior.then(() => slot);

    await prior;

    const { session, primed } = await this.takeSession(expectedText);
    if (primed) {
      // Predicted line already flushed — stop so Fish emits finish and drain ends.
      if (session.ws.readyState === WebSocket.OPEN) {
        session.stopSent = true;
        session.ws.send(encode({ event: "stop" }));
      }
    } else {
      void pump(session).catch((err) => {
        session.queue.fail(err instanceof Error ? err : new Error(String(err)));
      });
    }

    const pcmChunks: Buffer[] = [];
    try {
      for await (const chunk of session.queue.drain()) {
        pcmChunks.push(chunk);
        yield chunk;
      }
    } finally {
      session.close();
      this.maybeSetAnchor(Buffer.concat(pcmChunks), spokenText());
      this.warm();
      release();
    }
  }
}

async function* streamFishAudio(
  textStream: AsyncIterable<string>,
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
  /** Open WebSocket warmed while the caller is still speaking (preview / unbound only). */
  private warmSlot: { key: string; session: Promise<FishLiveSession> } | null = null;
  /** Session already synthesizing a predicted static line (unbound preview only). */
  private primedSlot: { key: string; text: string; session: Promise<FishLiveSession> } | null =
    null;
  /** When set, every utterance in this call uses the same Fish reference_id + prosody. */
  private callBound: TtsVoiceRequest | null = null;
  private callRunner: BoundCallUtteranceRunner | null = null;

  constructor(apiKey: string, options?: { model?: string | null }) {
    if (!apiKey) throw new Error("FishAudioTtsProvider requires an API key");
    this.apiKey = apiKey;
    this.defaultModel = resolveFishTtsModel(options?.model);
  }

  /** Lock Fish TTS to one voice profile for the whole call. */
  bindCall(req: TtsVoiceRequest): void {
    this.releaseCall();
    this.callBound = { ...req };
    this.callRunner = new BoundCallUtteranceRunner(this.apiKey, this.defaultModel, this.callBound);
    this.callRunner.warm();
  }

  releaseCall(): void {
    this.callBound = null;
    this.callRunner?.close();
    this.callRunner = null;
    this.warmSlot?.session.then((s) => s.close()).catch(() => {});
    this.warmSlot = null;
    this.primedSlot?.session.then((s) => s.close()).catch(() => {});
    this.primedSlot = null;
  }

  private effectiveRequest(req: TtsVoiceRequest): TtsVoiceRequest {
    if (this.callBound) {
      const voiceId = String(this.callBound.voiceId ?? "").trim();
      if (!voiceId) {
        throw new Error("Fish TTS call profile is missing reference_id");
      }
      const incoming = String(req.voiceId ?? "").trim();
      if (incoming && incoming !== voiceId) {
        console.warn(
          `[fish-tts] ignoring mid-call voice override attempt incoming=${incoming} locked=${voiceId}`,
        );
      }
      return { ...this.callBound, voiceId };
    }
    return req;
  }

  /** Pre-open the next synthesis session so the first audio chunk arrives sooner. */
  warm(req: TtsVoiceRequest): void {
    if (this.callRunner) {
      this.callRunner.warm();
      return;
    }
    req = this.effectiveRequest(req);
    const key = sessionKey(req, this.defaultModel);
    if (this.warmSlot?.key === key) return;
    this.primedSlot?.session.then((s) => s.close()).catch(() => {});
    this.primedSlot = null;
    this.warmSlot = {
      key,
      session: connectFishSession(req, this.apiKey, this.defaultModel),
    };
  }

  /** Speculative static warm for the next agent line. */
  warmWithText(text: string, req: TtsVoiceRequest): void {
    if (this.callRunner) {
      this.callRunner.warmWithText(text);
      return;
    }
    req = this.effectiveRequest(req);
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
    req = this.effectiveRequest(req);
    const trimmed = text.trim();
    const self = this;
    return alignPcm16(
      (async function* (): AsyncGenerator<Buffer> {
        if (!trimmed) return;

        if (self.callRunner) {
          yield* self.callRunner.runUtterance(
            (session) => pumpFishStaticChunks(session, trimmed),
            () => trimmed,
            trimmed,
          );
          return;
        }

        const segments = [...splitSpeakableChunks(trimmed)];
        if (segments.length === 1) {
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
          session.close();
        }

        const { session } = await self.takeSession(req);
        void pumpFishStaticChunks(session, trimmed);
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
    req = this.effectiveRequest(req);
    const self = this;
    return alignPcm16(
      (async function* (): AsyncGenerator<Buffer> {
        if (self.callRunner) {
          let spoken = "";
          async function* tap(): AsyncGenerator<string> {
            for await (const segment of textStream) {
              spoken += segment;
              yield segment;
            }
          }
          yield* self.callRunner.runUtterance(
            (session) => pumpFishText(session, tap()),
            () => spoken,
          );
          return;
        }
        const takeSession = async () => (await self.takeSession(req)).session;
        yield* streamFishAudio(textStream, takeSession);
      })(),
    );
  }
}
