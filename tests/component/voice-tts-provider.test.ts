import { afterEach, describe, expect, it } from "vitest";

import {
  alignPcm16,
  availableTtsProviders,
  batchIntoSentences,
  createTtsProvider,
} from "@/lib/voice/tts";

/** Collect an async generator into an array. */
async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

describe("alignPcm16", () => {
  it("passes through already-aligned chunks unchanged", async () => {
    const chunks = [Buffer.from([1, 2, 3, 4]), Buffer.from([5, 6])];
    const out = await collect(alignPcm16(fromArray(chunks)));
    expect(Buffer.concat(out)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
  });

  it("carries a split sample across chunk boundaries instead of shifting the stream", async () => {
    const chunks = [Buffer.from([1, 2, 3]), Buffer.from([4, 5, 6])];
    const out = await collect(alignPcm16(fromArray(chunks)));

    for (const buf of out) {
      expect(buf.byteLength % 2).toBe(0);
    }
    expect(Buffer.concat(out)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
  });

  it("drops a trailing incomplete sample", async () => {
    const out = await collect(alignPcm16(fromArray([Buffer.from([1, 2, 3])])));
    expect(Buffer.concat(out)).toEqual(Buffer.from([1, 2]));
  });

  it("handles a chunk that is a single orphan byte", async () => {
    const chunks = [Buffer.from([1]), Buffer.from([2]), Buffer.from([3]), Buffer.from([4])];
    const out = await collect(alignPcm16(fromArray(chunks)));
    expect(Buffer.concat(out)).toEqual(Buffer.from([1, 2, 3, 4]));
  });
});

describe("batchIntoSentences", () => {
  it("flushes on sentence-ending punctuation", async () => {
    const tokens = ["Hello", " there", ".", " How", " are", " you", "?"];
    const out = await collect(batchIntoSentences(fromArray(tokens)));
    expect(out).toEqual(["Hello there.", "How are you?"]);
  });

  it("emits a trailing fragment that never got punctuation", async () => {
    const out = await collect(batchIntoSentences(fromArray(["No", " ending"])));
    expect(out).toEqual(["No ending"]);
  });

  it("breaks on a word boundary once maxChars is exceeded so playback never stalls", async () => {
    const tokens = ["word ".repeat(10)];
    const out = await collect(batchIntoSentences(fromArray(tokens), 20));
    expect(out.length).toBeGreaterThan(1);
    for (const seg of out) {
      expect(seg).not.toMatch(/\bwor$|\bwo$|\bw$/);
    }
    expect(out.join(" ").replace(/\s+/g, " ").trim()).toBe("word ".repeat(10).trim());
  });

  it("treats newlines as a boundary", async () => {
    const out = await collect(batchIntoSentences(fromArray(["line one\n", "line two"])));
    expect(out).toEqual(["line one", "line two"]);
  });

  it("yields nothing for an empty stream", async () => {
    expect(await collect(batchIntoSentences(fromArray([])))).toEqual([]);
  });
  it("flushes an early first chunk for low-latency streaming", async () => {
    const { batchForVoiceLatency, VOICE_LATENCY_TTS_BATCH } = await import("@/lib/voice/tts/types");
    const tokens = ["Hello", " there", " friend", " how", " are", " you?"];
    const out = await collect(batchForVoiceLatency(fromArray(tokens)));
    expect(out.length).toBeGreaterThan(1);
    expect(out[0].length).toBeLessThanOrEqual(VOICE_LATENCY_TTS_BATCH.firstFlushChars + 8);
  });

  it("normalizes spaced punctuation from streamed tokens", async () => {
    const { normalizeSpeechText } = await import("@/lib/voice/tts/types");
    expect(normalizeSpeechText("Hi , may I have your name , please ?")).toBe(
      "Hi, may I have your name, please?",
    );
  });
});

describe("Fish TTS model", () => {
  it("defaults to s2.1-pro-free", async () => {
    const { FISH_TTS_DEFAULT_MODEL, resolveFishTtsModel } = await import(
      "@/lib/voice/tts/fish.provider"
    );
    expect(FISH_TTS_DEFAULT_MODEL).toBe("s2.1-pro-free");
    expect(resolveFishTtsModel()).toBe("s2.1-pro-free");
  });

  it("honours FISH_TTS_MODEL override", async () => {
    const prev = process.env.FISH_TTS_MODEL;
    process.env.FISH_TTS_MODEL = "s2.1-pro";
    const { resolveFishTtsModel } = await import("@/lib/voice/tts/fish.provider");
    expect(resolveFishTtsModel()).toBe("s2.1-pro");
    if (prev === undefined) delete process.env.FISH_TTS_MODEL;
    else process.env.FISH_TTS_MODEL = prev;
  });
});

describe("createTtsProvider", () => {
  const originalFish = process.env.FISH_API_KEY;

  afterEach(() => {
    if (originalFish === undefined) delete process.env.FISH_API_KEY;
    else process.env.FISH_API_KEY = originalFish;
  });

  it("creates Fish Audio TTS when a key is present", () => {
    const provider = createTtsProvider(null, { fishApiKey: "fish-key" });
    expect(provider.name).toBe("fish");
  });

  it("prefers a per-workspace key over the platform env key", () => {
    delete process.env.FISH_API_KEY;
    const provider = createTtsProvider(null, { fishApiKey: "workspace-fish" });
    expect(provider.name).toBe("fish");
  });

  it("throws when FISH_API_KEY is missing", () => {
    delete process.env.FISH_API_KEY;
    expect(() => createTtsProvider(null, {})).toThrow(/FISH_API_KEY/);
  });

  it("reports Fish when configured", () => {
    delete process.env.FISH_API_KEY;
    expect(availableTtsProviders({})).toEqual([]);
    expect(availableTtsProviders({ fishApiKey: "k" })).toEqual(["fish"]);
  });
});
