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
    // 3 bytes then 3 bytes: naive forwarding would emit an odd-length frame and
    // shift every following sample by one byte, turning speech into noise.
    const chunks = [Buffer.from([1, 2, 3]), Buffer.from([4, 5, 6])];
    const out = await collect(alignPcm16(fromArray(chunks)));

    // Every emitted buffer must hold whole samples.
    for (const buf of out) {
      expect(buf.byteLength % 2).toBe(0);
    }
    // And no bytes may be reordered or lost.
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
    // Must have split rather than buffering the whole clause.
    expect(out.length).toBeGreaterThan(1);
    // No segment may split a word.
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
});

describe("createTtsProvider", () => {
  const originalFish = process.env.FISH_API_KEY;
  const originalEl = process.env.ELEVENLABS_API_KEY;

  afterEach(() => {
    if (originalFish === undefined) delete process.env.FISH_API_KEY;
    else process.env.FISH_API_KEY = originalFish;
    if (originalEl === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = originalEl;
  });

  it("prefers Fish Audio when no explicit preference is given", () => {
    const provider = createTtsProvider(null, {
      fishApiKey: "fish-key",
      elevenLabsApiKey: "el-key",
    });
    expect(provider.name).toBe("fish");
  });

  it("honours an explicit ElevenLabs preference", () => {
    const provider = createTtsProvider("elevenlabs", {
      fishApiKey: "fish-key",
      elevenLabsApiKey: "el-key",
    });
    expect(provider.name).toBe("elevenlabs");
  });

  it("falls back to the other provider when the preferred one has no key", () => {
    const provider = createTtsProvider("fish", { elevenLabsApiKey: "el-key" });
    expect(provider.name).toBe("elevenlabs");
  });

  it("prefers a per-workspace key over the platform env key", () => {
    process.env.ELEVENLABS_API_KEY = "platform-el";
    delete process.env.FISH_API_KEY;
    const provider = createTtsProvider(null, { fishApiKey: "workspace-fish" });
    expect(provider.name).toBe("fish");
  });

  it("throws a directive error when nothing is configured", () => {
    delete process.env.FISH_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    expect(() => createTtsProvider(null, {})).toThrow(/FISH_API_KEY or ELEVENLABS_API_KEY/);
  });

  it("reports which providers are usable", () => {
    delete process.env.FISH_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    expect(availableTtsProviders({})).toEqual([]);
    expect(availableTtsProviders({ fishApiKey: "k" })).toEqual(["fish"]);
    expect(availableTtsProviders({ fishApiKey: "k", elevenLabsApiKey: "k2" })).toEqual([
      "fish",
      "elevenlabs",
    ]);
  });
});
