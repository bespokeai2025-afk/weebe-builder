import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A fake Fish realtime transcription socket. Appended audio accumulates until `commit`, which is
 * acknowledged and then answered with a transcript naming how many bytes it covered — so a test
 * can tell exactly which audio a result came from.
 */
const sockets: FakeWs[] = [];

class FakeWs extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  readyState = FakeWs.CONNECTING;
  commits: number[] = [];
  private buffered = 0;
  private item = 0;
  constructor() {
    super();
    sockets.push(this);
    setTimeout(() => {
      this.readyState = FakeWs.OPEN;
      this.emit("open");
      // The real server sends this after the handshake, once the session is listening.
      setTimeout(() => this.reply({ type: "transcription_session.created" }), 5);
    }, 0);
  }
  send(raw: string): void {
    const msg = JSON.parse(raw) as { type: string; audio?: string };
    if (msg.type === "transcription_session.update") this.reply({ type: "transcription_session.updated" });
    if (msg.type === "input_audio_buffer.append") this.buffered += Buffer.from(msg.audio!, "base64").byteLength;
    if (msg.type === "input_audio_buffer.commit") {
      const bytes = this.buffered;
      this.buffered = 0;
      this.commits.push(bytes);
      const id = `item_${++this.item}`;
      this.reply({ type: "input_audio_buffer.committed", item_id: id });
      setTimeout(
        () =>
          this.reply({
            type: "conversation.item.input_audio_transcription.completed",
            item_id: id,
            transcript: `heard ${bytes} bytes`,
          }),
        5,
      );
    }
  }
  reply(msg: Record<string, unknown>): void {
    this.emit("message", Buffer.from(JSON.stringify(msg)));
  }
  close(): void {
    this.emit("close");
  }
  terminate(): void {
    this.close();
  }
}

vi.mock("ws", () => ({ WebSocket: FakeWs }));
const { FishSttProvider, FISH_SPECULATIVE_PAUSE_MS } = await import("@/lib/voice/stt/fish");

const RATE = 16000;
const FRAME_BYTES = 640; // 20ms
const speech = () => {
  const b = Buffer.alloc(FRAME_BYTES);
  for (let i = 0; i < FRAME_BYTES; i += 2) b.writeInt16LE(i % 4 === 0 ? 4000 : -4000, i);
  return b;
};
const silence = () => Buffer.alloc(FRAME_BYTES);
const pauseFrames = Math.ceil(FISH_SPECULATIVE_PAUSE_MS / 20);
const tick = () => new Promise((r) => setTimeout(r, 20));

describe("Fish realtime STT — speculative full-utterance commits", () => {
  beforeEach(() => {
    sockets.length = 0;
  });

  async function open() {
    const partials: string[] = [];
    const session = await new FishSttProvider("key").open({
      sampleRate: RATE,
      language: "en",
      onPartial: (t) => partials.push(t),
    });
    return { session, partials, ws: sockets[0]! };
  }

  it("commits the utterance at a pause and reports it as a partial", async () => {
    const { session, partials, ws } = await open();
    for (let i = 0; i < 10; i++) session.push(speech());
    for (let i = 0; i < pauseFrames; i++) session.push(silence());
    await tick();
    expect(ws.commits).toHaveLength(1);
    expect(partials).toEqual([`heard ${ws.commits[0]} bytes`]);
  });

  it("uses the pause's transcript as the final when nothing was said after it", async () => {
    const { session, ws } = await open();
    for (let i = 0; i < 10; i++) session.push(speech());
    for (let i = 0; i < pauseFrames + 5; i++) session.push(silence());
    await tick();
    const text = await session.finalizeUtterance([]);
    expect(ws.commits).toHaveLength(1);
    expect(text).toBe(`heard ${ws.commits[0]} bytes`);
  });

  it("re-commits the whole utterance when the caller kept talking after the pause", async () => {
    const { session, ws } = await open();
    for (let i = 0; i < 10; i++) session.push(speech());
    for (let i = 0; i < pauseFrames; i++) session.push(silence());
    for (let i = 0; i < 10; i++) session.push(speech());
    const text = await session.finalizeUtterance([]);
    expect(ws.commits).toHaveLength(2);
    // The second commit re-sends everything, so it covers more than the first.
    expect(ws.commits[1]!).toBeGreaterThan(ws.commits[0]!);
    expect(text).toBe(`heard ${ws.commits[1]} bytes`);
  });

  it("does not send the silence before the caller starts speaking", async () => {
    const { session, ws } = await open();
    for (let i = 0; i < 200; i++) session.push(silence()); // 4s of waiting
    for (let i = 0; i < 10; i++) session.push(speech());
    await session.finalizeUtterance([]);
    // 10 speech frames plus at most the 400ms pre-speech window.
    expect(ws.commits[0]!).toBeLessThanOrEqual(10 * FRAME_BYTES + 0.4 * RATE * 2 + FRAME_BYTES);
  });

  it("starts each utterance fresh after the buffer is cleared", async () => {
    const { session, partials, ws } = await open();
    for (let i = 0; i < 10; i++) session.push(speech());
    session.clearInputBuffer?.();
    for (let i = 0; i < 5; i++) session.push(speech());
    const text = await session.finalizeUtterance([]);
    expect(ws.commits).toEqual([5 * FRAME_BYTES]);
    expect(text).toBe(`heard ${5 * FRAME_BYTES} bytes`);
    expect(partials).toEqual([text]);
  });
});
