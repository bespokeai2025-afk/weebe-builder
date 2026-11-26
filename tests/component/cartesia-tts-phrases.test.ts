import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A fake Cartesia TTS socket with context semantics: each transcript gets an audio chunk, and
 * `done` comes only when a message closes the context (no `continue`). With `refuseBufferDelay`
 * set it answers any message carrying `max_buffer_delay_ms` with an error, like an API version
 * that predates the field.
 */
const sockets: FakeWs[] = [];
class FakeWs extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static refuseBufferDelay = false;
  readyState = FakeWs.CONNECTING;
  sent: Array<Record<string, unknown>> = [];
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
    const ctx = msg.context_id;
    const reply = (m: Record<string, unknown>) =>
      setTimeout(
        () => this.emit("message", Buffer.from(JSON.stringify({ ...m, context_id: ctx }))),
        1,
      );
    if (FakeWs.refuseBufferDelay && "max_buffer_delay_ms" in msg) {
      reply({
        type: "error",
        message: "Unrecognized field: max_buffer_delay_ms",
        status_code: 400,
      });
      return;
    }
    if (msg.transcript) reply({ type: "chunk", data: Buffer.alloc(4).toString("base64") });
    if (!msg.continue) reply({ type: "done" });
  }
  terminate(): void {
    this.readyState = FakeWs.CLOSED;
  }
}
vi.mock("ws", () => ({ WebSocket: FakeWs }));
const { CartesiaTtsProvider, resetCartesiaBufferDelayForTests } =
  await import("@/lib/voice/tts/cartesia.provider");

const req = { voiceId: "v", sampleRate: 24000 } as never;
async function* tokens(parts: string[]) {
  for (const p of parts) yield p;
}
const drain = async (it: AsyncIterable<unknown>) => {
  let n = 0;
  for await (const _ of it) n++;
  return n;
};
const ENV = "WEBEE_NATIVE_CARTESIA_MAX_BUFFER_DELAY_MS";

describe("Cartesia streamed replies", () => {
  beforeEach(() => {
    sockets.length = 0;
    FakeWs.refuseBufferDelay = false;
    resetCartesiaBufferDelayForTests();
    delete process.env[ENV];
  });
  afterEach(() => {
    delete process.env[ENV];
  });

  it("cuts the reply into phrases and turns Cartesia's buffering off", async () => {
    const tts = new CartesiaTtsProvider("k");
    await drain(
      tts.synthesizeStream(
        tokens(["Sure", ",", " I can", " help with", " that.", " What is", " your name?"]),
        req,
      ),
    );
    const sent = sockets[0]!.sent;
    // "Sure," alone is too short to be its own phrase; the first cut is at the first clause after it,
    // and the rest of the reply is sent as the message that closes the context.
    expect(sent.map((m) => m.transcript)).toEqual([
      "Sure, I can help with that.",
      " What is your name?",
    ]);
    expect(sent.every((m) => m.max_buffer_delay_ms === 0)).toBe(true);
    expect(sent.slice(0, -1).every((m) => m.continue === true)).toBe(true);
    expect(sent.at(-1)!.continue).toBeUndefined();
    // One context for the whole reply, so it is spoken as one line.
    expect(new Set(sent.map((m) => m.context_id)).size).toBe(1);
  });

  it("hands buffering to Cartesia when the delay is set above 0", async () => {
    process.env[ENV] = "1500";
    const tts = new CartesiaTtsProvider("k");
    await drain(tts.synthesizeStream(tokens(["Sure", ",", " thanks."]), req));
    const sent = sockets[0]!.sent;
    expect(sent.map((m) => m.transcript)).toEqual(["Sure", ",", " thanks.", ""]);
    expect(sent.every((m) => m.max_buffer_delay_ms === 1500)).toBe(true);
  });

  it("retries without the field when the API version refuses it, and stops sending it", async () => {
    FakeWs.refuseBufferDelay = true;
    const tts = new CartesiaTtsProvider("k");
    const chunks = await drain(
      tts.synthesizeStream(tokens(["Hello there,", " how are you today?"]), req),
    );
    expect(chunks).toBeGreaterThan(0);
    const retry = sockets[1]!.sent;
    expect(retry.map((m) => m.transcript)).toEqual(["Hello there,", " how are you today?"]);
    expect(retry.at(-1)!.continue).toBeUndefined();
    expect(retry.some((m) => "max_buffer_delay_ms" in m)).toBe(false);

    // Later replies on this server leave it out from the start.
    await drain(tts.synthesizeStream(tokens(["Okay."]), req));
    expect(sockets).toHaveLength(3);
    expect(sockets[2]!.sent.some((m) => "max_buffer_delay_ms" in m)).toBe(false);
  });
});
