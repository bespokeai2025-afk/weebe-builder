import { describe, expect, it } from "vitest";
import {
  AMBIENT_KINDS,
  AmbientMixer,
  AmbientPacer,
  clampAmbientVolume,
  decodeWavToMono,
  generateAmbientBed,
  parseAmbientKind,
} from "@/lib/voice/audio/ambient";

const rms = (x: ArrayLike<number>) => Math.sqrt(Array.from(x).reduce((s, v) => s + v * v, 0) / x.length);

describe("ambient beds", () => {
  it.each(AMBIENT_KINDS)("%s: is deterministic, at the base level, and loops without a jump", (kind) => {
    const a = generateAmbientBed(kind, 8000);
    expect(a.length).toBe(24 * 8000);
    expect(rms(a)).toBeGreaterThan(540);
    expect(rms(a)).toBeLessThan(660);
    // Same bed every time (cached, and seeded).
    expect(generateAmbientBed(kind, 8000)).toBe(a);
    // The wrap-around step is no bigger than the loudest ordinary step.
    let maxStep = 0;
    for (let i = 1; i < 40_000; i++) maxStep = Math.max(maxStep, Math.abs(a[i]! - a[i - 1]!));
    expect(Math.abs(a[0]! - a[a.length - 1]!)).toBeLessThanOrEqual(maxStep);
  });

  it("different beds sound different", () => {
    const zc = (x: Int16Array) => {
      let n = 0;
      for (let i = 1; i < x.length; i++) if ((x[i]! >= 0) !== (x[i - 1]! >= 0)) n++;
      return n;
    };
    // Static is brighter than wind.
    expect(zc(generateAmbientBed("static-noise", 8000))).toBeGreaterThan(zc(generateAmbientBed("mountain-outdoor", 8000)) * 2);
  });

  it("parses names and clamps volume", () => {
    expect(parseAmbientKind("coffee-shop")).toBe("coffee-shop");
    expect(parseAmbientKind("none")).toBeNull();
    expect(parseAmbientKind(undefined)).toBeNull();
    expect(clampAmbientVolume(5)).toBe(2);
    expect(clampAmbientVolume(-1)).toBe(0);
    expect(clampAmbientVolume("x")).toBe(1);
  });
});

describe("AmbientMixer", () => {
  it("adds the bed to speech, loops it, scales by volume, and saturates instead of wrapping", () => {
    const bed = Int16Array.from([100, 200, 300]);
    const mixer = new AmbientMixer(bed, 2);
    const out = mixer.mixInto(Int16Array.from([0, 0, 0, 0]));
    expect(Array.from(out)).toEqual([200, 400, 600, 200]); // looped back to the start
    const hot = new AmbientMixer(Int16Array.from([30000]), 2).mixInto(Int16Array.from([30000, -30000]));
    expect(Array.from(hot)).toEqual([32767, 30000]);
  });
});

describe("AmbientPacer", () => {
  function harness(leadMs = 100) {
    let clock = 0;
    const timers: Array<{ at: number; fn: () => void }> = [];
    const sent: Array<{ frame: Int16Array; hasAgent: boolean }> = [];
    const pacer = new AmbientPacer({
      mixer: new AmbientMixer(new Int16Array(160).fill(10), 1),
      sampleRate: 8000,
      leadMs,
      send: (frame, hasAgent) => sent.push({ frame, hasAgent }),
      now: () => clock,
      setTimer: (fn, ms) => {
        const t = { at: clock + ms, fn };
        timers.push(t);
        return t;
      },
      clearTimer: (h) => {
        const i = timers.indexOf(h as never);
        if (i >= 0) timers.splice(i, 1);
      },
    });
    const advance = (ms: number) => {
      const end = clock + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        clock = Math.max(clock, next.at);
        next.fn();
      }
      clock = end;
    };
    return { pacer, sent, advance };
  }

  it("sends the bed continuously, one 20 ms frame at a time, even with no speech", () => {
    const { pacer, sent, advance } = harness();
    pacer.start();
    advance(1000);
    // ~50 frames per second plus the lead.
    expect(sent.length).toBeGreaterThanOrEqual(50);
    expect(sent.length).toBeLessThanOrEqual(58);
    expect(sent.every((f) => f.frame.length === 160 && !f.hasAgent)).toBe(true);
    expect(sent[0]!.frame[0]).toBe(10);
    pacer.stop();
  });

  it("puts agent speech into the stream at real-time pace, over the bed", () => {
    const { pacer, sent, advance } = harness();
    pacer.start();
    advance(200);
    const before = sent.length;
    pacer.pushAgent(new Int16Array(160 * 5).fill(1000)); // 100 ms of speech
    advance(400);
    const withAgent = sent.slice(before).filter((f) => f.hasAgent);
    expect(withAgent).toHaveLength(5);
    expect(withAgent[0]!.frame[0]).toBe(1010); // speech + bed
    expect(pacer.queuedSamples).toBe(0);
    pacer.stop();
  });

  it("drops unsent speech on barge-in and keeps the bed going", () => {
    const { pacer, sent, advance } = harness();
    pacer.start();
    advance(100);
    pacer.pushAgent(new Int16Array(160 * 50).fill(1000)); // a full second queued
    advance(100);
    pacer.clearAgent();
    const marker = sent.length;
    advance(300);
    expect(sent.slice(marker).every((f) => !f.hasAgent)).toBe(true);
    expect(sent.length - marker).toBeGreaterThan(10);
    pacer.stop();
  });

  it("reports when the queued speech has all been sent", () => {
    const { pacer, advance } = harness();
    pacer.start();
    let done = false;
    pacer.pushAgent(new Int16Array(160 * 25).fill(500)); // 500 ms
    pacer.afterAgentDrained(() => (done = true));
    expect(done).toBe(false);
    advance(100);
    expect(done).toBe(false);
    advance(500);
    expect(done).toBe(true);
    let immediate = false;
    pacer.afterAgentDrained(() => (immediate = true));
    expect(immediate).toBe(true);
    pacer.stop();
  });

  it("splits speech that doesn't line up with the frame size", () => {
    const { pacer, sent, advance } = harness();
    pacer.start();
    pacer.pushAgent(new Int16Array(100).fill(7));
    pacer.pushAgent(new Int16Array(100).fill(9));
    advance(200);
    const agent = sent.filter((f) => f.hasAgent);
    expect(agent).toHaveLength(2);
    expect(Array.from(agent[0]!.frame.slice(95, 105))).toEqual([17, 17, 17, 17, 17, 19, 19, 19, 19, 19]);
    pacer.stop();
  });
});

describe("decodeWavToMono", () => {
  function wav(samples: Int16Array, rate: number, channels = 1): Buffer {
    const data = Buffer.alloc(samples.length * 2);
    samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
    const h = Buffer.alloc(44);
    h.write("RIFF", 0);
    h.writeUInt32LE(36 + data.length, 4);
    h.write("WAVEfmt ", 8);
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20);
    h.writeUInt16LE(channels, 22);
    h.writeUInt32LE(rate, 24);
    h.writeUInt32LE(rate * 2 * channels, 28);
    h.writeUInt16LE(2 * channels, 32);
    h.writeUInt16LE(16, 34);
    h.write("data", 36);
    h.writeUInt32LE(data.length, 40);
    return Buffer.concat([h, data]);
  }
  it("reads mono and takes the first channel of stereo", () => {
    expect(Array.from(decodeWavToMono(wav(Int16Array.from([1, 2, 3]), 8000), 8000)!)).toEqual([1, 2, 3]);
    expect(Array.from(decodeWavToMono(wav(Int16Array.from([1, 9, 2, 9]), 8000, 2), 8000)!)).toEqual([1, 2]);
  });
  it("resamples and rejects non-WAV input", () => {
    expect(decodeWavToMono(wav(new Int16Array(160).fill(100), 16000), 8000)!.length).toBeCloseTo(80, -1);
    expect(decodeWavToMono(Buffer.from("not a wav file at all, definitely not......................."), 8000)).toBeNull();
  });
});
