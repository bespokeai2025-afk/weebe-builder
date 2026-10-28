/**
 * Fish realtime STT session against a local stand-in for Fish's server: config, drafts, finalize,
 * turns Fish never opened, dropped turns, and turns Fish commits on its own. Also the TTS
 * `language` field and the renamed Drama model.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import type { AddressInfo } from "node:net";
import { decode, encode } from "@msgpack/msgpack";
import { cleanFishLiveText, FishLiveSttSession, fishLiveTerms } from "@/lib/voice/stt/fish-live";
import { buildStartRequest, fishTtsLanguage, resolveFishTtsModel } from "@/lib/voice/tts/fish.provider";

type Msg = Record<string, unknown> & { type: string };

/** Minimal Fish: opens a turn on the first audio, answers `finalize` with the scripted text. */
class FakeFish {
  readonly server: WebSocketServer;
  readonly received: Msg[] = [];
  socket: ServerSocket | null = null;
  turn = 0;
  turnOpen = false;
  finalText = "Yes, that's right.";
  answerFinalize = true;
  refuseConfig = false;
  headers: Record<string, string | string[] | undefined> = {};

  constructor() {
    this.server = new WebSocketServer({ port: 0 });
    this.server.on("connection", (ws, req) => {
      this.socket = ws;
      this.headers = req.headers;
      ws.on("message", (raw) => {
        const msg = decode(raw as Buffer) as Msg;
        this.received.push(msg);
        if (msg.type === "config") {
          if (this.refuseConfig) {
            this.send({ type: "error", code: 400, error_type: "invalid_config", message: "bad", recoverable: false });
            ws.close(4400);
            return;
          }
          this.send({ type: "session_started", seq: 0, session_id: "s", request_id: "r" });
        }
        if (msg.type === "audio" && !this.turnOpen) {
          this.turnOpen = true;
          this.send({ type: "speech_start", turn_index: this.turn, audio_ms: 0 });
        }
        if (msg.type === "finalize" && this.turnOpen && this.answerFinalize) {
          this.turnOpen = false;
          this.send({ type: "committed", turn_index: this.turn, text: this.finalText, reason: "finalize", user_turn: true });
          this.turn += 1;
        }
      });
    });
  }

  get url(): string {
    return `ws://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  send(msg: Msg): void {
    this.socket?.send(encode(msg));
  }

  close(): Promise<void> {
    for (const c of this.server.clients) c.terminate();
    return new Promise((r) => this.server.close(() => r()));
  }
}

const frame = (ms = 100, rate = 16000) => Buffer.alloc(Math.floor((rate * ms) / 1000) * 2, 1);
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe("Fish realtime STT session", () => {
  let fish: FakeFish;
  let session: FishLiveSttSession | null = null;

  beforeEach(() => {
    fish = new FakeFish();
  });
  afterEach(async () => {
    session?.close();
    session = null;
    await fish.close();
  });

  const open = (extra: Record<string, unknown> = {}) =>
    FishLiveSttSession.connect("key", { sampleRate: 16000, language: "en", ...extra } as any, fish.url);

  it("opens with manual turn detection, drafts on, the call's sample rate and keyword hints", async () => {
    session = await open({ keywords: ["Elm Road", "Gilmartin", "x".repeat(40), "elm road"] });
    expect(fish.headers.model).toBe("transcribe-stream-1");
    const config = fish.received.find((m) => m.type === "config")!;
    expect(config).toMatchObject({
      audio: { format: "pcm_s16le", sample_rate: 16000, channels: 1 },
      turn_detection: { mode: "manual" },
      results: { drafts: true, diarize: false },
      context: { terms: ["Elm Road", "Gilmartin"] },
    });
  });

  it("refuses a sample rate Fish does not accept, so the provider falls back", async () => {
    await expect(open({ sampleRate: 11025 })).rejects.toThrow(/11025/);
  });

  it("fails to open when Fish rejects the config", async () => {
    fish.refuseConfig = true;
    await expect(open()).rejects.toThrow(/invalid_config/);
  });

  it("passes drafts on as partials and returns Fish's final on finalize", async () => {
    const partials: string[] = [];
    session = await open({ onPartial: (t: string) => partials.push(t) });
    session.push(frame());
    await tick();
    fish.send({ type: "draft", turn_index: 0, text: "Yes, that's [laughter] right", settled_text: "" });
    await tick();
    expect(partials).toEqual(["Yes, that's right"]);

    const final = await session.finalizeUtterance([frame()]);
    expect(final).toBe("Yes, that's right.");
    expect(fish.received.filter((m) => m.type === "finalize")).toHaveLength(1);
  });

  it("sends audio in chunks of about 80 ms, not every small frame", async () => {
    session = await open();
    for (let i = 0; i < 8; i++) session.push(frame(20));
    await tick();
    const audio = fish.received.filter((m) => m.type === "audio");
    expect(audio).toHaveLength(2);
    expect((audio[0]!.data as Uint8Array).byteLength).toBe(16000 * 2 * 0.08);
  });

  it("returns nothing quickly when Fish heard no speech", async () => {
    session = await open();
    const started = Date.now();
    expect(await session.finalizeUtterance([])).toBe("");
    expect(Date.now() - started).toBeLessThan(1000);
    expect(fish.received.some((m) => m.type === "finalize")).toBe(false);
  });

  it("drops a turn cleared before the caller's real reply", async () => {
    fish.finalText = "echo of the agent";
    session = await open();
    session.push(frame());
    await tick();
    session.clearInputBuffer();
    await tick();

    fish.finalText = "No, not really.";
    session.push(frame());
    await tick();
    expect(await session.finalizeUtterance([frame()])).toBe("No, not really.");
  });

  it("keeps words Fish committed on its own and joins them to the final", async () => {
    session = await open();
    session.push(frame());
    await tick();
    // Over 60 s: Fish ends the turn itself, then the caller keeps talking.
    fish.send({ type: "committed", turn_index: 0, text: "First part.", reason: "max_turn_duration", user_turn: true });
    fish.turn = 1;
    fish.turnOpen = false;
    await tick();
    session.push(frame());
    await tick();
    fish.finalText = "second part.";
    expect(await session.finalizeUtterance([frame()])).toBe("First part. second part.");
  });

  it("uses the last draft when the final does not come back in time", async () => {
    fish.answerFinalize = false;
    session = await open();
    session.push(frame());
    await tick();
    fish.send({ type: "draft", turn_index: 0, text: "Tuesday at two", settled_text: "" });
    await tick();
    expect(await session.finalizeUtterance([frame()])).toBe("Tuesday at two");
  }, 5000);

  it("gives Fish the agent's lines as context", async () => {
    session = await open();
    session.addContext("assistant", "  Is it a house or a flat?  ");
    await tick();
    expect(fish.received.find((m) => m.type === "context_add")).toMatchObject({
      items: [{ role: "assistant", text: "Is it a house or a flat?" }],
    });
  });
});

describe("helpers", () => {
  it("strips sound tags and speaker markers", () => {
    expect(cleanFishLiveText("<|speaker:0|>Yes [sighs] I suppose [pause] so")).toBe("Yes I suppose so");
  });

  it("limits keyword hints to Fish's 100 terms of 32 characters", () => {
    const many = Array.from({ length: 150 }, (_, i) => `term${i}`);
    expect(fishLiveTerms(many)).toHaveLength(100);
    expect(fishLiveTerms(["ok", "y".repeat(33), "OK"])).toEqual(["ok"]);
  });
});

describe("Fish TTS", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sends the agent's one language so numbers and dates read the local way", () => {
    expect(fishTtsLanguage(["en-GB"])).toBe("en-GB");
    expect(fishTtsLanguage(["en_GB"])).toBe("en-GB");
    expect(fishTtsLanguage(["en-GB", "es-ES"])).toBeUndefined();
    expect(fishTtsLanguage(["multi"])).toBeUndefined();
    expect(fishTtsLanguage(undefined)).toBeUndefined();
    const req = buildStartRequest({ voiceId: "v", sampleRate: 16000, language: "en-GB" });
    expect(req.language).toBe("en-GB");
    expect(buildStartRequest({ voiceId: "v", sampleRate: 16000 })).not.toHaveProperty("language");
  });

  it("maps the old Drama preview id to the released one", () => {
    expect(resolveFishTtsModel("drama-3-preview")).toBe("drama-3");
    expect(resolveFishTtsModel("drama-3")).toBe("drama-3");
    expect(resolveFishTtsModel("s2.1-pro")).toBe("s2.1-pro");
  });
});
