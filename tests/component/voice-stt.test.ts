import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AssemblyAiSttProvider,
  CartesiaSttProvider,
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
  delete process.env.ASSEMBLYAI_API_KEY;
  delete process.env.CARTESIA_API_KEY;
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

  it("uses AssemblyAI when preferred and ASSEMBLYAI_API_KEY is set", () => {
    process.env.ASSEMBLYAI_API_KEY = "aai";
    process.env.FISH_API_KEY = "fish";

    const provider = createSttProvider("assemblyai");
    expect(provider).toBeInstanceOf(AssemblyAiSttProvider);
    expect(provider.name).toBe("assemblyai");
    expect(provider.streaming).toBe(true);
  });

  it("throws when AssemblyAI is selected without ASSEMBLYAI_API_KEY", () => {
    process.env.FISH_API_KEY = "fish";
    expect(() => createSttProvider("assemblyai")).toThrow(/ASSEMBLYAI_API_KEY/);
  });

  it("uses Cartesia when preferred and CARTESIA_API_KEY is set", () => {
    process.env.CARTESIA_API_KEY = "car";
    process.env.FISH_API_KEY = "fish";

    const provider = createSttProvider("cartesia");
    expect(provider).toBeInstanceOf(CartesiaSttProvider);
    expect(provider.name).toBe("cartesia");
    expect(provider.streaming).toBe(true);
  });

  it("throws when Cartesia is selected without CARTESIA_API_KEY", () => {
    process.env.FISH_API_KEY = "fish";
    expect(() => createSttProvider("cartesia")).toThrow(/CARTESIA_API_KEY/);
  });

  // Asserted per provider rather than as a whole list: OpenAI is now a third engine and whether it
  // appears depends on OPENAI_API_KEY being present in the environment running the tests.
  it("reports availability without constructing anything", () => {
    expect(availableSttProviders()).not.toContain("fish");
    expect(availableSttProviders()).not.toContain("deepgram");
    process.env.FISH_API_KEY = "fish";
    expect(availableSttProviders()).toContain("fish");
    process.env.DEEPGRAM_API_KEY = "dg";
    expect(availableSttProviders()).toContain("deepgram");
    expect(availableSttProviders({ assemblyaiApiKey: "aai" })).toContain("assemblyai");
    expect(availableSttProviders({ cartesiaApiKey: "car" })).toContain("cartesia");
    expect(availableSttProviders({ openaiApiKey: "sk-test" })).toContain("openai");
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

  it("honours an explicit AssemblyAI selection", () => {
    expect(resolveWebeeSttPreference({ webeeSttProvider: "assemblyai" })).toBe("assemblyai");
  });

  it("honours an explicit Cartesia selection", () => {
    expect(resolveWebeeSttPreference({ webeeSttProvider: "cartesia" })).toBe("cartesia");
  });

  it("honours an explicit Fish selection", () => {
    process.env.FISH_API_KEY = "fish";
    process.env.DEEPGRAM_API_KEY = "dg";
    expect(resolveWebeeSttPreference({ webeeSttProvider: "fish" })).toBe("fish");
  });

  // Whisper is now a third engine, so "no Fish key" no longer means "no engine". What still must
  // hold is that Fish is not chosen without a Fish key.
  it("does not fall back to Fish when FISH_API_KEY is missing", () => {
    expect(resolveWebeeSttPreference({})).not.toBe("fish");
  });
});

describe("parseSttProviderName", () => {
  it("accepts fish, deepgram, assemblyai and openai", () => {
    expect(parseSttProviderName("fish")).toBe("fish");
    expect(parseSttProviderName("Deepgram")).toBe("deepgram");
    expect(parseSttProviderName("openai")).toBe("openai");
    expect(parseSttProviderName("AssemblyAI")).toBe("assemblyai");
    expect(parseSttProviderName("Cartesia")).toBe("cartesia");
    // The provider calls itself "whisper"; accepted as an alias for the same engine.
    expect(parseSttProviderName("whisper")).toBe("openai");
    // Vendor spelling/spacing variants for AssemblyAI.
    expect(parseSttProviderName("assembly-ai")).toBe("assemblyai");
    expect(parseSttProviderName("assembly ai")).toBe("assemblyai");
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

describe("AssemblyAI live listen", () => {
  it("builds a pcm_s16le URL at the cascade sample rate with key terms", async () => {
    const { buildAssemblyAiListenUrl, ASSEMBLYAI_KEEPALIVE_MS } = await import(
      "@/lib/voice/stt/assemblyai"
    );
    const url = buildAssemblyAiListenUrl({
      sampleRate: 24_000,
      keywords: ["Jumeirah", ""],
    });
    expect(url).toContain("wss://streaming.assemblyai.com/v3/ws");
    expect(url).toContain("encoding=pcm_s16le");
    expect(url).toContain("sample_rate=24000");
    expect(url).toContain("speech_model=universal-streaming-english");
    expect(url).toContain(encodeURIComponent(JSON.stringify(["Jumeirah"])));
    expect(ASSEMBLYAI_KEEPALIVE_MS).toBeLessThan(10_000);
  });

  it("omits keyterms_prompt when there are no keywords", async () => {
    const { buildAssemblyAiListenUrl } = await import("@/lib/voice/stt/assemblyai");
    const url = buildAssemblyAiListenUrl({ sampleRate: 16_000 });
    expect(url).not.toContain("keyterms_prompt");
  });
});

describe("Cartesia live listen", () => {
  it("builds a pcm_s16le URL at the cascade sample rate with the ink-whisper model", async () => {
    const { buildCartesiaListenUrl, CARTESIA_KEEPALIVE_MS } = await import(
      "@/lib/voice/stt/cartesia"
    );
    const url = buildCartesiaListenUrl({ sampleRate: 24_000, language: "en" });
    expect(url).toContain("wss://api.cartesia.ai/stt/websocket");
    expect(url).toContain("model=ink-whisper");
    expect(url).toContain("encoding=pcm_s16le");
    expect(url).toContain("sample_rate=24000");
    expect(url).toContain("language=en");
    expect(url).toContain("cartesia_version=");
    expect(CARTESIA_KEEPALIVE_MS).toBeLessThan(180_000);
  });

  it("omits language when none is given", async () => {
    const { buildCartesiaListenUrl } = await import("@/lib/voice/stt/cartesia");
    const url = buildCartesiaListenUrl({ sampleRate: 16_000 });
    expect(url).not.toContain("language=");
  });
});
