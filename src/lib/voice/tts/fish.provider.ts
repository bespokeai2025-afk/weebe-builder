/**
 * Fish Audio streaming TTS provider.
 *
 * Protocol (wss://api.fish.audio/v1/tts/live/with-timestamp, MessagePack binary frames):
 *   client -> { event: "start", request: {...} }   opens one synthesis session
 *   client -> { event: "text",  text: "..." }      appends text to the session buffer
 *   client -> { event: "flush" }                   forces buffered text through generation
 *   client -> { event: "stop" }                    ends the session; server drains, then `finish`
 *   server -> { event: "audio", audio, alignment, chunk_seq, chunk_audio_offset_sec }
 *   server -> { event: "finish", reason: "stop" | "error" }
 *   server -> { event: "error", ... }             request-level failure; socket closes
 *
 * One agent line = one Fish session: start → text… → stop → finish. After `finish` the same
 * socket takes the next `start` (documented for the with-timestamp endpoint), so a call keeps one
 * TCP/TLS connection for all its lines without ever guessing where a line ends.
 *
 * Why not one session for the whole call (what this used to do): Fish holds the last few
 * milliseconds of a flushed line until the next text/flush/stop arrives, and labels the next
 * line's first audio with the previous line's chunk, so inside one long session there is no
 * signal that a line is complete. The old code ended each line after 0.9–3.2s of audio silence —
 * adding that wait to every line and cutting long ones that paused mid-sentence — and an
 * interrupted line's leftover audio was pushed into the NEXT line's queue on the reused socket.
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

const FISH_TTS_WS = "wss://api.fish.audio/v1/tts/live/with-timestamp";
const CONNECT_TIMEOUT_MS = 10_000;
/** One retry on a failed handshake (429 concurrency, 503 load). Fish sends no Retry-After. */
const CONNECT_RETRY_DELAY_MS = 300;
/**
 * After `stop`, how long to wait for `finish` before giving up on the session. Fish streams faster
 * than real time, so a line normally finishes well inside its own spoken duration; this only
 * bounds a stuck socket.
 */
const FINISH_TIMEOUT_MS = 20_000;
/** Nucleus sampling — lower keeps clone timbre from jumping between utterances. */
const FISH_CLONE_TOP_P = 0.5;
/** Target chunk size (Fish allows 100–300, default 300). Smaller starts first audio sooner. */
const FISH_CLONE_CHUNK_LENGTH = 200;
/** Don't emit a fragment shorter than a word; 80 blocked first-audio by a full clause. */
export const FISH_CLONE_MIN_CHUNK_LENGTH = 12;
/** First live flush once we have a speakable phrase — matches VOICE_LATENCY_TTS_BATCH. */
export const FISH_STREAM_FIRST_FLUSH_CHARS = 12;
/** Keep enough of the greeting to lock timbre; cap payload size. */
const ANCHOR_MAX_SECONDS = 3;
const ANCHOR_MIN_SECONDS = 1.2;

/** Models the `model` connection header accepts (docs.fish.audio OpenAPI enum). */
const KNOWN_MODELS = new Set(["s1", "s2-pro", "s2.1-pro", "s2.1-pro-free", "drama-3-preview"]);

/**
 * WEBEE Native default — Fish S2.1 Pro free tier (same model, fair-use API, no latency
 * guarantee). Fish lists it at no cost through 30 November 2026; after that set
 * FISH_TTS_MODEL=s2.1-pro.
 */
export const FISH_TTS_DEFAULT_MODEL = "s2.1-pro-free";
const FREE_TIER_ENDS = Date.UTC(2026, 11, 1);
let freeTierWarned = false;

/** Resolve TTS model: per-request → FISH_TTS_MODEL env → s2.1-pro-free. */
export function resolveFishTtsModel(override?: string | null): string {
  const pick = String(override ?? process.env.FISH_TTS_MODEL ?? FISH_TTS_DEFAULT_MODEL).trim();
  const model = KNOWN_MODELS.has(pick) ? pick : FISH_TTS_DEFAULT_MODEL;
  if (model === "s2.1-pro-free" && Date.now() >= FREE_TIER_ENDS && !freeTierWarned) {
    freeTierWarned = true;
    console.warn(
      "[fish-tts] s2.1-pro-free was free only through 2026-11-30 — set FISH_TTS_MODEL=s2.1-pro",
    );
  }
  return model;
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
    if (this.ended) return;
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

/**
 * One open WebSocket. Runs at most one Fish session at a time; `session` is null between
 * sessions, when the socket is idle and ready for the next `start`.
 */
interface FishSocket {
  ws: WebSocket;
  session: { queue: ChunkQueue; finished: boolean; usedAnchor: boolean } | null;
  /** Set when a session failed with the voice anchor attached, so the owner can drop it. */
  onAnchorError?: () => void;
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
    // Measured on s2.1-pro-free: low ≈ balanced (~470–510ms to first audio), normal ~2.5s.
    latency: req.latency ?? "balanced",
    reference_id: voiceId,
    condition_on_previous_chunks: true,
    normalize: true,
    top_p: FISH_CLONE_TOP_P,
    chunk_length: FISH_CLONE_CHUNK_LENGTH,
    min_chunk_length: FISH_CLONE_MIN_CHUNK_LENGTH,
  };
  // Owned clones only. Every agent line is now its own Fish session, so the anchor travels with
  // every `start` and costs ~70ms of first-audio latency each time (measured). Clones need it —
  // they re-sample timbre per session and the caller hears the voice change. Library voices are
  // trained models that stay consistent from `reference_id` alone, so they skip that cost.
  if (req.cloneVoice && anchor?.wav.byteLength && anchor.text.trim()) {
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
    ws.once("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      reject(new Error(`Fish Audio TTS handshake rejected: HTTP ${res.statusCode}`));
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

function attachFishHandlers(sock: FishSocket): void {
  const { ws } = sock;
  ws.on("message", (data: import("ws").RawData) => {
    const session = sock.session;
    try {
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
      const msg = decode(buf) as FishServerEvent;

      if (msg.event === "audio") {
        // Trailing audio events can carry empty bytes (alignment corrections only).
        if (session && msg.audio?.byteLength) session.queue.push(Buffer.from(msg.audio));
        return;
      }
      if (msg.event === "finish") {
        if (!session) return;
        session.finished = true;
        sock.session = null;
        if (msg.reason === "error") {
          console.error("[fish-tts] session finished with reason=error");
          if (session.usedAnchor) sock.onAnchorError?.();
          session.queue.fail(new Error("Fish Audio TTS synthesis failed: finish reason=error"));
        } else {
          session.queue.end();
        }
        return;
      }
      if (msg.event === "error") {
        const detail = msg.message ?? msg.reason ?? "unknown error";
        console.error(`[fish-tts] server error event: ${detail}`);
        if (session?.usedAnchor) sock.onAnchorError?.();
        session?.queue.fail(new Error(`Fish Audio TTS error: ${detail}`));
        return;
      }
      // Clients must ignore unknown events (forward-compatible protocol).
    } catch (err) {
      session?.queue.fail(err instanceof Error ? err : new Error(String(err)));
    }
  });
  ws.on("error", (err: Error) => sock.session?.queue.fail(err));
  ws.on("close", () => {
    const session = sock.session;
    sock.session = null;
    if (session && !session.finished) {
      session.queue.fail(new Error("Fish Audio TTS socket closed before the line finished"));
    }
  });
}

async function openFishSocketOnce(apiKey: string, model: string): Promise<FishSocket> {
  const ws = new WebSocket(FISH_TTS_WS, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      model,
    },
  });
  // Late errors after a failed handshake must not crash the process.
  ws.on("error", () => {});
  const sock: FishSocket = {
    ws,
    session: null,
    close() {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    },
  };
  await waitForOpen(ws);
  attachFishHandlers(sock);
  return sock;
}

async function openFishSocket(
  req: TtsVoiceRequest,
  apiKey: string,
  defaultModel: string,
): Promise<FishSocket> {
  const model = resolveModel(req, defaultModel);
  try {
    return await openFishSocketOnce(apiKey, model);
  } catch (err) {
    console.warn(
      `[fish-tts] connect failed (${err instanceof Error ? err.message : String(err)}), retrying once`,
    );
    await new Promise((r) => setTimeout(r, CONNECT_RETRY_DELAY_MS));
    return openFishSocketOnce(apiKey, model);
  }
}

function isIdle(sock: FishSocket | null | undefined): boolean {
  return !!sock && sock.ws.readyState === WebSocket.OPEN && sock.session === null;
}

/** Open a new Fish session on an idle socket and return its audio queue. */
function startSession(
  sock: FishSocket,
  req: TtsVoiceRequest,
  anchor: FishVoiceAnchor | null,
): ChunkQueue {
  if (!isIdle(sock)) throw new Error("Fish Audio TTS socket is not idle");
  const request = buildStartRequest(req, anchor);
  const queue = new ChunkQueue();
  sock.session = { queue, finished: false, usedAnchor: Boolean(request.references) };
  sock.ws.send(encode({ event: "start", request }));
  return queue;
}

/** End the session's input. Fish drains what is buffered and answers with `finish`. */
function stopSession(sock: FishSocket): void {
  const session = sock.session;
  if (!session) return;
  if (sock.ws.readyState !== WebSocket.OPEN) {
    session.queue.fail(new Error("Fish Audio TTS socket closed before stop"));
    return;
  }
  sock.ws.send(encode({ event: "stop" }));
  const timer = setTimeout(() => {
    if (sock.session !== session) return;
    console.error(`[fish-tts] no finish within ${FINISH_TIMEOUT_MS}ms of stop — closing socket`);
    session.queue.fail(new Error("Fish Audio TTS did not finish the line"));
    sock.close();
  }, FINISH_TIMEOUT_MS);
  timer.unref?.();
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

/** Stream text into the socket's current session, then stop it. */
async function pumpFishText(sock: FishSocket, textStream: AsyncIterable<string>): Promise<void> {
  const session = sock.session;
  if (!session) return;
  try {
    let buffered = "";
    let flushed = false;
    for await (const segment of textStream) {
      if (!segment) continue;
      if (sock.session !== session) return;
      if (sock.ws.readyState !== WebSocket.OPEN) {
        session.queue.fail(new Error("Fish Audio TTS socket closed during synthesis"));
        return;
      }
      buffered += segment;
      sock.ws.send(encode({ event: "text", text: segment }));
      if (shouldFlushFishLiveBuffer(buffered, flushed)) {
        sock.ws.send(encode({ event: "flush" }));
        flushed = true;
        buffered = "";
      }
    }
    if (sock.session === session) stopSession(sock);
  } catch (err) {
    session.queue.fail(err instanceof Error ? err : new Error(String(err)));
    sock.close();
  }
}

/** Send a complete line in one text event (splitting resamples the clone mid-line), then stop. */
function pumpFishStaticText(sock: FishSocket, text: string): void {
  const session = sock.session;
  if (!session) return;
  if (sock.ws.readyState !== WebSocket.OPEN) {
    session.queue.fail(new Error("Fish Audio TTS socket closed during synthesis"));
    return;
  }
  sock.ws.send(encode({ event: "text", text }));
  stopSession(sock);
}

/**
 * Release a socket after a line. Reusable only when the line reached `finish`; a line abandoned
 * mid-synthesis (barge-in, error) still has audio in flight that would land in the next line, so
 * that socket is closed instead.
 */
function releaseSocket(sock: FishSocket): FishSocket | null {
  if (isIdle(sock)) return sock;
  sock.close();
  return null;
}

class BoundCallUtteranceRunner {
  private utteranceChain: Promise<void> = Promise.resolve();
  /** Idle socket ready for the next line's `start`. */
  private idle: FishSocket | null = null;
  /** Handshake in progress for the next line. */
  private connecting: Promise<FishSocket> | null = null;
  /** A predicted static line already synthesizing on its own session. */
  private primed: { text: string; sock: FishSocket; queue: ChunkQueue } | null = null;
  /** First in-call agent audio — later lines of an owned clone reference it. */
  private anchor: FishVoiceAnchor | null = null;
  private busy = false;
  private closed = false;

  constructor(
    private readonly apiKey: string,
    private readonly defaultModel: string,
    private readonly req: TtsVoiceRequest,
  ) {}

  close(): void {
    this.closed = true;
    this.idle?.close();
    this.idle = null;
    this.connecting?.then((s) => s.close()).catch(() => {});
    this.connecting = null;
    this.primed?.sock.close();
    this.primed = null;
    this.anchor = null;
  }

  private adopt(sock: FishSocket): FishSocket {
    sock.onAnchorError = () => {
      if (!this.anchor) return;
      console.warn("[fish-tts] line failed with the voice anchor attached — dropping the anchor");
      this.anchor = null;
    };
    return sock;
  }

  /** Hold a reusable socket for the next line, unless one is already held. */
  private keepIdle(sock: FishSocket | null): void {
    if (!sock) return;
    const held = this.idle;
    if (this.closed || (held && isIdle(held))) {
      sock.close();
      return;
    }
    this.idle = sock;
  }

  /** Make sure an idle socket is open (or opening) for the next line. */
  warm(): void {
    if (this.closed || this.busy || this.primed || this.connecting) return;
    if (isIdle(this.idle)) return;
    this.idle = null;
    const pending = openFishSocket(this.req, this.apiKey, this.defaultModel).then((s) =>
      this.adopt(s),
    );
    this.connecting = pending;
    pending
      .then((sock) => {
        if (this.connecting !== pending) return;
        this.connecting = null;
        if (this.closed || isIdle(this.idle)) {
          sock.close();
          return;
        }
        this.idle = sock;
      })
      .catch((err) => {
        if (this.connecting === pending) this.connecting = null;
        console.warn(`[fish-tts] warm connect failed: ${err instanceof Error ? err.message : err}`);
      });
  }

  /** Take an idle socket: the warm one, an in-flight handshake, or a fresh connection. */
  private async acquire(): Promise<FishSocket> {
    const held = this.idle;
    if (held && isIdle(held)) {
      this.idle = null;
      return held;
    }
    this.idle?.close();
    this.idle = null;
    if (this.connecting) {
      const pending = this.connecting;
      this.connecting = null;
      try {
        const sock = await pending;
        if (isIdle(sock)) return sock;
      } catch {
        /* fall through to a fresh connection */
      }
    }
    return this.adopt(await openFishSocket(this.req, this.apiKey, this.defaultModel));
  }

  private discardPrimed(): void {
    const primed = this.primed;
    if (!primed) return;
    this.primed = null;
    this.keepIdle(releaseSocket(primed.sock));
  }

  /** Start synthesizing a predicted static line while the caller is still talking. */
  warmWithText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) {
      this.warm();
      return;
    }
    if (this.closed || this.busy || this.primed?.text === trimmed) return;
    this.discardPrimed();

    const sock = this.idle && isIdle(this.idle) ? this.idle : null;
    if (sock) {
      this.idle = null;
      const queue = startSession(sock, this.req, this.anchor);
      pumpFishStaticText(sock, trimmed);
      this.primed = { text: trimmed, sock, queue };
      return;
    }
    // No idle socket yet: open one; prime it only if nothing else claimed the slot meanwhile.
    this.warm();
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

  async *runUtterance(
    pump: (sock: FishSocket) => Promise<void> | void,
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
    this.busy = true;

    let sock: FishSocket | null = null;
    const pcmChunks: Buffer[] = [];
    try {
      let queue: ChunkQueue;
      const want = expectedText?.trim();
      if (want && this.primed?.text === want) {
        ({ sock, queue } = this.primed);
        this.primed = null;
      } else {
        this.discardPrimed();
        sock = await this.acquire();
        const model = resolveModel(this.req, this.defaultModel);
        console.log(
          `[fish-tts] utterance reference_id=${this.req.voiceId} model=${model}` +
            ` sample_rate=${this.req.sampleRate}` +
            (typeof this.req.temperature === "number"
              ? ` temp=${this.req.temperature.toFixed(2)}`
              : "") +
            (typeof this.req.speed === "number" ? ` speed=${this.req.speed}` : "") +
            (this.req.cloneVoice && this.anchor ? " anchor=on" : " anchor=off"),
        );
        queue = startSession(sock, this.req, this.anchor);
        const active = sock;
        void Promise.resolve()
          .then(() => pump(active))
          .catch((err) => queue.fail(err instanceof Error ? err : new Error(String(err))));
      }

      for await (const chunk of queue.drain()) {
        pcmChunks.push(chunk);
        yield chunk;
      }
    } finally {
      this.maybeSetAnchor(Buffer.concat(pcmChunks), spokenText());
      this.keepIdle(sock ? releaseSocket(sock) : null);
      this.busy = false;
      release();
      this.warm();
    }
  }
}

export class FishAudioTtsProvider implements TtsProvider {
  readonly name = "fish";
  private readonly apiKey: string;
  private readonly defaultModel: string;
  /** Open WebSocket warmed while the caller is still speaking (preview / unbound only). */
  private warmSlot: { key: string; sock: Promise<FishSocket> } | null = null;
  /** Session already synthesizing a predicted static line (unbound preview only). */
  private primedSlot: {
    key: string;
    text: string;
    started: Promise<{ sock: FishSocket; queue: ChunkQueue }>;
  } | null = null;
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
    this.dropWarmSlot();
    this.dropPrimedSlot();
  }

  private dropWarmSlot(): void {
    this.warmSlot?.sock.then((s) => s.close()).catch(() => {});
    this.warmSlot = null;
  }

  private dropPrimedSlot(): void {
    this.primedSlot?.started.then(({ sock }) => sock.close()).catch(() => {});
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

  /** Pre-open the next synthesis socket so the first audio chunk arrives sooner. */
  warm(req: TtsVoiceRequest): void {
    if (this.callRunner) {
      this.callRunner.warm();
      return;
    }
    req = this.effectiveRequest(req);
    const key = sessionKey(req, this.defaultModel);
    if (this.warmSlot?.key === key) return;
    this.dropPrimedSlot();
    this.dropWarmSlot();
    const sock = openFishSocket(req, this.apiKey, this.defaultModel);
    sock.catch(() => {});
    this.warmSlot = { key, sock };
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

    const pendingSock = this.warmSlot?.key === key ? this.warmSlot.sock : null;
    this.warmSlot = null;
    this.dropPrimedSlot();
    const started = (async () => {
      const sock = await (pendingSock ?? openFishSocket(req, this.apiKey, this.defaultModel));
      const queue = startSession(sock, req, null);
      pumpFishStaticText(sock, trimmed);
      return { sock, queue };
    })();
    started.catch(() => {});
    this.primedSlot = { key, text: trimmed, started };
  }

  /** A socket with a session already started for this line (primed, warm or fresh). */
  private async startLine(
    req: TtsVoiceRequest,
    expectedText?: string,
  ): Promise<{ sock: FishSocket; queue: ChunkQueue; primed: boolean }> {
    const key = sessionKey(req, this.defaultModel);
    const trimmed = expectedText?.trim();

    if (trimmed && this.primedSlot?.key === key && this.primedSlot.text === trimmed) {
      const slot = this.primedSlot;
      this.primedSlot = null;
      try {
        return { ...(await slot.started), primed: true };
      } catch {
        /* fall through to a fresh session */
      }
    } else if (this.primedSlot?.key === key) {
      this.dropPrimedSlot();
    }

    let sock: FishSocket | null = null;
    if (this.warmSlot?.key === key) {
      const slot = this.warmSlot;
      this.warmSlot = null;
      sock = await slot.sock.catch(() => null);
    }
    const ready = sock && isIdle(sock) ? sock : await openFishSocket(req, this.apiKey, this.defaultModel);
    return { sock: ready, queue: startSession(ready, req, null), primed: false };
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
            (sock) => pumpFishStaticText(sock, trimmed),
            () => trimmed,
            trimmed,
          );
          return;
        }

        // A primed slot only ever holds a single-segment line.
        const single = [...splitSpeakableChunks(trimmed)].length === 1;
        const { sock, queue, primed } = await self.startLine(req, single ? trimmed : undefined);
        if (!primed) pumpFishStaticText(sock, trimmed);
        try {
          yield* queue.drain();
        } finally {
          sock.close();
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
            (sock) => pumpFishText(sock, tap()),
            () => spoken,
          );
          return;
        }
        const { sock, queue } = await self.startLine(req);
        void pumpFishText(sock, textStream);
        try {
          yield* queue.drain();
        } finally {
          sock.close();
        }
      })(),
    );
  }
}
