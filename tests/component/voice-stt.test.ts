import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DeepgramSttProvider,
  FishSttProvider,
  availableSttProviders,
  buildWav,
  createSttProvider,
  parseSttProviderName,
  resolveWebeeSttPreference,
} from "@/lib/voice/stt";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.FISH_API_KEY;
  delete process.env.DEEPGRAM_API_KEY;
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("createSttProvider", () => {
  it("uses Fish streaming ASR when FISH_API_KEY is set", () => {
    process.env.FISH_API_KEY = "fish";

    const provider = createSttProvider(null);
    expect(provider.name).toBe("fish");
    expect(provider.streaming).toBe(true);
  });

  it("uses Deepgram when preferred and DEEPGRAM_API_KEY is set", () => {
    process.env.DEEPGRAM_API_KEY = "dg";
    process.env.FISH_API_KEY = "fish";

    const provider = createSttProvider("deepgram");
    expect(provider).toBeInstanceOf(DeepgramSttProvider);
    expect(provider.name).toBe("deepgram");
    expect(provider.streaming).toBe(true);
  });

  it("keeps Fish when Deepgram is not selected, even if both keys exist", () => {
    process.env.FISH_API_KEY = "fish";
    process.env.DEEPGRAM_API_KEY = "dg";

    expect(createSttProvider("fish").name).toBe("fish");
    expect(createSttProvider(null).name).toBe("fish");
  });

  it("throws when FISH_API_KEY is missing", () => {
    expect(() => createSttProvider(null)).toThrow(/FISH_API_KEY/);
    expect(() => new FishSttProvider("")).toThrow(/API key/);
  });

  it("throws when Deepgram is selected without DEEPGRAM_API_KEY", () => {
    process.env.FISH_API_KEY = "fish";
    expect(() => createSttProvider("deepgram")).toThrow(/DEEPGRAM_API_KEY/);
  });

  it("reports availability without constructing anything", () => {
    expect(availableSttProviders()).toEqual([]);
    process.env.FISH_API_KEY = "fish";
    expect(availableSttProviders()).toEqual(["fish"]);
    process.env.DEEPGRAM_API_KEY = "dg";
    expect(availableSttProviders()).toEqual(["fish", "deepgram"]);
  });
});

describe("resolveWebeeSttPreference", () => {
  it("returns fish when FISH_API_KEY is set", () => {
    process.env.FISH_API_KEY = "fish";
    expect(resolveWebeeSttPreference({})).toBe("fish");
  });

  it("honours an explicit Deepgram selection", () => {
    expect(resolveWebeeSttPreference({ webeeSttProvider: "deepgram" })).toBe("deepgram");
  });

  it("honours an explicit Fish selection", () => {
    process.env.FISH_API_KEY = "fish";
    process.env.DEEPGRAM_API_KEY = "dg";
    expect(resolveWebeeSttPreference({ webeeSttProvider: "fish" })).toBe("fish");
  });

  it("returns null when FISH_API_KEY is missing", () => {
    expect(resolveWebeeSttPreference({})).toBeNull();
  });
});

describe("parseSttProviderName", () => {
  it("accepts fish and deepgram only", () => {
    expect(parseSttProviderName("fish")).toBe("fish");
    expect(parseSttProviderName("Deepgram")).toBe("deepgram");
    expect(parseSttProviderName("whisper")).toBeNull();
    expect(parseSttProviderName("")).toBeNull();
  });
});

describe("FishSttProvider session", () => {
  it("ignores pushed frames, since it cannot consume a live stream", async () => {
    const session = await new FishSttProvider("key").open({ sampleRate: 24_000 });

    expect(() => session.push(Buffer.alloc(480))).not.toThrow();
    expect(await session.finalizeUtterance([])).toBe("");
    session.close();
  });
});

describe("buildWav", () => {
  it("writes a canonical 44-byte header at the session's sample rate", () => {
    const pcm = Buffer.alloc(480);
    const wav = buildWav([pcm], 16_000);

    expect(wav.byteLength).toBe(44 + pcm.byteLength);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.subarray(8, 12).toString()).toBe("WAVE");
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt32LE(28)).toBe(16_000 * 2);
    expect(wav.readUInt16LE(32)).toBe(2);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(pcm.byteLength);
  });

  it("concatenates frames in order", () => {
    const a = Buffer.from([1, 0, 2, 0]);
    const b = Buffer.from([3, 0, 4, 0]);

    expect(buildWav([a, b]).subarray(44)).toEqual(Buffer.concat([a, b]));
  });
});

describe("Deepgram live listen", () => {
  it("builds a linear16 URL at the cascade sample rate with keywords", async () => {
    const { buildDeepgramListenUrl, DEEPGRAM_KEEPALIVE_MS } = await import(
      "@/lib/voice/stt/deepgram"
    );
    const url = buildDeepgramListenUrl({
      sampleRate: 24_000,
      language: "en",
      keywords: ["Jumeirah", ""],
    });
    expect(url).toContain("encoding=linear16");
    expect(url).toContain("sample_rate=24000");
    expect(url).toContain("model=nova-2");
    expect(url).toContain("keywords=Jumeirah");
    expect(DEEPGRAM_KEEPALIVE_MS).toBeLessThan(10_000);
  });
});
