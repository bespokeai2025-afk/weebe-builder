import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** A fake Cartesia TTS socket: opens on the next tick, answers each transcript with one chunk + done. */
const sockets: FakeWs[] = [];
class FakeWs extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  readyState = FakeWs.CONNECTING;
  sent: Array<Record<string, unknown>> = [];
  terminated = false;
  constructor(public url: string) {
    super();
    sockets.push(this);
    setTimeout(() => {
      this.readyState = FakeWs.OPEN;
      this.emit("open");
    }, 1);
  }
  send(raw: string): void {
    const msg = JSON.parse(raw) as Record<string, unknown>;
    this.sent.push(msg);
    if (msg.transcript) {
      setTimeout(() => {
        const ctx = msg.context_id;
        this.emit("message", Buffer.from(JSON.stringify({ type: "chunk", data: Buffer.alloc(4).toString("base64"), context_id: ctx })));
        this.emit("message", Buffer.from(JSON.stringify({ type: "done", context_id: ctx })));
      }, 1);
    }
  }
  terminate(): void {
    this.terminated = true;
    this.readyState = FakeWs.CLOSED;
  }
}
vi.mock("ws", () => ({ WebSocket: FakeWs }));
const { CartesiaTtsProvider } = await import("@/lib/voice/tts/cartesia.provider");

const req = { voiceId: "v", sampleRate: 24000 } as never;
const drain = async (it: AsyncIterable<unknown>) => {
  for await (const _ of it) void _;
};
const tick = () => new Promise((r) => setTimeout(r, 5));

describe("Cartesia TTS warm-up", () => {
  beforeEach(() => {
    sockets.length = 0;
  });

  it("speaks on the socket opened by warm() instead of connecting again", async () => {
    const tts = new CartesiaTtsProvider("k");
    tts.warm();
    await tick();
    expect(sockets).toHaveLength(1);
    await drain(tts.synthesize("Hello there", req));
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.sent[0]).toMatchObject({ transcript: "Hello there" });
  });

  it("opens only one warm socket however often warm() is called", async () => {
    const tts = new CartesiaTtsProvider("k");
    tts.warm();
    tts.warm();
    tts.warm();
    expect(sockets).toHaveLength(1);
  });

  it("connects fresh when the warm socket has closed", async () => {
    const tts = new CartesiaTtsProvider("k");
    tts.warm();
    await tick();
    sockets[0]!.readyState = FakeWs.CLOSED;
    await drain(tts.synthesize("Hi", req));
    expect(sockets).toHaveLength(2);
    expect(sockets[1]!.sent[0]).toMatchObject({ transcript: "Hi" });
  });

  it("each reply uses its own socket: the warm one is used once", async () => {
    const tts = new CartesiaTtsProvider("k");
    tts.warm();
    await drain(tts.synthesize("One", req));
    await drain(tts.synthesize("Two", req));
    expect(sockets).toHaveLength(2);
  });

  it("closes an unused warm socket when the call ends", async () => {
    const tts = new CartesiaTtsProvider("k");
    tts.warm();
    await tick();
    tts.releaseCall();
    await tick();
    expect(sockets[0]!.terminated).toBe(true);
  });
});
