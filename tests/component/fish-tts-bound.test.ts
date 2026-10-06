import { EventEmitter } from "node:events";
import { decode, encode } from "@msgpack/msgpack";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A fake Fish `/v1/tts/live/with-timestamp` server. Each socket runs sessions the way the real one
 * does: `start` opens one, `text` buffers, `stop` streams the audio and then sends `finish`, and the
 * same socket accepts another `start` afterwards. Audio bytes encode the line's text so a test can
 * tell which line any chunk belongs to.
 */
const sockets: FakeWs[] = [];
let holdFinish = false;

class FakeWs extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = FakeWs.CONNECTING;
  starts: Array<Record<string, unknown>> = [];
  private text = "";
  constructor(
    readonly url: string,
    readonly opts: { headers: Record<string, string> },
  ) {
    super();
    sockets.push(this);
    setTimeout(() => {
      this.readyState = FakeWs.OPEN;
      this.emit("open");
    }, 0);
  }
  send(data: Uint8Array): void {
    const msg = decode(data) as { event: string; text?: string; request?: Record<string, unknown> };
    if (msg.event === "start") {
      this.starts.push(msg.request ?? {});
      this.text = "";
    } else if (msg.event === "text") {
      this.text += msg.text ?? "";
    } else if (msg.event === "stop") {
      const line = this.text;
      setTimeout(() => {
        if (this.readyState !== FakeWs.OPEN) return;
        // Two chunks, so a consumer can stop after the first (barge-in).
        this.reply({ event: "audio", audio: Buffer.from(`${line}#1|`) });
        this.reply({ event: "audio", audio: Buffer.from(`${line}#2|`) });
        if (!holdFinish) this.reply({ event: "finish", reason: "stop" });
      }, 0);
    }
  }
  reply(event: Record<string, unknown>): void {
    this.emit("message", Buffer.from(encode(event)));
  }
  terminate(): void {
    if (this.readyState === FakeWs.CLOSED) return;
    this.readyState = FakeWs.CLOSED;
    this.emit("close", 1006, Buffer.from(""));
  }
  close(): void {
    this.terminate();
  }
}

vi.mock("ws", () => ({ WebSocket: FakeWs }));

const {
  buildStartRequest,
  FISH_CLONE_MIN_CHUNK_LENGTH,
  FISH_STREAM_FIRST_FLUSH_CHARS,
  FishAudioTtsProvider,
  shouldFlushFishLiveBuffer,
} = await import("@/lib/voice/tts/fish.provider");

async function speak(gen: AsyncGenerator<Buffer>, stopAfter = Infinity): Promise<string> {
  let out = "";
  let n = 0;
  for await (const chunk of gen) {
    out += chunk.toString();
    if (++n >= stopAfter) break;
  }
  return out;
}

/** Regression guard: bound-call TTS must always emit the same locked reference_id. */
describe("fish-tts bound call", () => {
  const lockedProfile = {
    voiceId: "164a9e442b984c3aa3fa8a21fd29a10c",
    sampleRate: 24000,
    temperature: 0.4,
    speed: 1.12,
    latency: "low" as const,
  };

  it("buildStartRequest uses locked reference_id and stability flags on every utterance", () => {
    const req = buildStartRequest(lockedProfile);
    expect(req.reference_id).toBe(lockedProfile.voiceId);
    expect(req.temperature).toBe(0.4);
    expect(req.top_p).toBe(0.5);
    expect(req.chunk_length).toBe(200);
    expect(req.min_chunk_length).toBe(FISH_CLONE_MIN_CHUNK_LENGTH);
    expect(FISH_CLONE_MIN_CHUNK_LENGTH).toBe(FISH_STREAM_FIRST_FLUSH_CHARS);
    expect(req.prosody).toEqual({ speed: 1.12, normalize_loudness: true });
    expect(req.condition_on_previous_chunks).toBe(true);
    expect(req.normalize).toBe(true);
  });

  it("identical profile produces identical start payloads across utterances", () => {
    const a = buildStartRequest(lockedProfile);
    const b = buildStartRequest({ ...lockedProfile });
    expect(a).toEqual(b);
    expect(a.references).toBeUndefined();
  });

  it("attaches in-call greeting audio as Fish references only for owned clones", () => {
    const wav = Buffer.from("RIFF");
    const library = buildStartRequest(lockedProfile, {
      wav,
      text: "Hi, this is Clare calling.",
    });
    expect(library.references).toBeUndefined();

    const clone = buildStartRequest(
      { ...lockedProfile, cloneVoice: true },
      { wav, text: "Hi, this is Clare calling." },
    );
    expect(clone.reference_id).toBe(lockedProfile.voiceId);
    expect(Array.isArray(clone.references)).toBe(true);
    const refs = clone.references as Array<{ audio: Uint8Array; text: string }>;
    expect(refs[0]?.text).toBe("Hi, this is Clare calling.");
    expect(refs[0]?.audio.byteLength).toBe(wav.byteLength);
  });
});

describe("Fish bound call: one session per line on a reused socket", () => {
  const profile = { voiceId: "voice-1", sampleRate: 24000, latency: "low" as const };

  beforeEach(() => {
    sockets.length = 0;
    holdFinish = false;
  });

  it("uses the documented with-timestamp endpoint", async () => {
    const tts = new FishAudioTtsProvider("key");
    tts.bindCall(profile);
    await speak(tts.synthesize("Hello there.", profile));
    expect(sockets[0]?.url).toBe("wss://api.fish.audio/v1/tts/live/with-timestamp");
    tts.releaseCall();
  });

  it("ends each line on finish and runs the next line as a new session on the same socket", async () => {
    const tts = new FishAudioTtsProvider("key");
    tts.bindCall(profile);
    const first = await speak(tts.synthesize("Is it vacant?", profile));
    const second = await speak(tts.synthesize("Is it freehold?", profile));
    expect(first).toBe("Is it vacant?#1|Is it vacant?#2|");
    expect(second).toBe("Is it freehold?#1|Is it freehold?#2|");
    const used = sockets.filter((s) => s.starts.length > 0);
    expect(used).toHaveLength(1);
    expect(used[0]!.starts).toHaveLength(2);
    tts.releaseCall();
  });

  it("closes a socket left mid-line by a barge-in, so its leftover audio never reaches the next line", async () => {
    const tts = new FishAudioTtsProvider("key");
    tts.bindCall(profile);
    holdFinish = true;
    await speak(tts.synthesize("A long line the caller interrupts.", profile), 1);
    holdFinish = false;
    const next = await speak(tts.synthesize("Sorry, go ahead.", profile));
    expect(next).toBe("Sorry, go ahead.#1|Sorry, go ahead.#2|");
    const interrupted = sockets.find((s) => s.starts.length > 0)!;
    expect(interrupted.readyState).toBe(FakeWs.CLOSED);
    tts.releaseCall();
  });

  it("streams LLM text and still ends the line on finish", async () => {
    const tts = new FishAudioTtsProvider("key");
    tts.bindCall(profile);
    async function* tokens() {
      yield "Could I take ";
      yield "your name, please?";
    }
    const out = await speak(tts.synthesizeStream(tokens(), profile));
    expect(out).toBe("Could I take your name, please?#1|Could I take your name, please?#2|");
    tts.releaseCall();
  });
});

describe("Fish live first-audio flush", () => {
  it("flushes the first phrase well before a full sentence", () => {
    expect(shouldFlushFishLiveBuffer("Thank you, ", false)).toBe(true);
    expect(shouldFlushFishLiveBuffer("Hi there friend", false)).toBe(true);
    expect(shouldFlushFishLiveBuffer("Yes.", false)).toBe(false);
    expect(shouldFlushFishLiveBuffer("Great, ok.", false)).toBe(true);
  });

  it("does not wait for a 40-character sentence before first audio", () => {
    expect(shouldFlushFishLiveBuffer("Can I take your", false)).toBe(true);
    expect(shouldFlushFishLiveBuffer("Th", false)).toBe(false);
  });

  it("after the first flush, waits for a real sentence", () => {
    expect(shouldFlushFishLiveBuffer("name please", true)).toBe(false);
    expect(shouldFlushFishLiveBuffer("Could I take your full name please?", true)).toBe(true);
  });
});
