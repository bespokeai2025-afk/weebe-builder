import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DeepgramSttProvider,
  WhisperSttProvider,
  availableSttProviders,
  buildWav,
  createSttProvider,
} from "@/lib/voice/stt";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.DEEPGRAM_API_KEY;
  delete process.env.OPENAI_API_KEY;
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("createSttProvider", () => {
  it("prefers streaming recognition when Deepgram is available", () => {
    process.env.DEEPGRAM_API_KEY = "dg";
    process.env.OPENAI_API_KEY = "oai";

    const provider = createSttProvider(null);
    // Streaming takes the whole transcription off the turn's latency budget.
    expect(provider.name).toBe("deepgram");
    expect(provider.streaming).toBe(true);
  });

  it("falls back to Whisper when only an OpenAI key is present", () => {
    process.env.OPENAI_API_KEY = "oai";

    const provider = createSttProvider(null);
    expect(provider.name).toBe("whisper");
    expect(provider.streaming).toBe(false);
  });

  it("honours an explicit choice", () => {
    process.env.DEEPGRAM_API_KEY = "dg";
    process.env.OPENAI_API_KEY = "oai";

    expect(createSttProvider("whisper").name).toBe("whisper");
    expect(createSttProvider("deepgram").name).toBe("deepgram");
  });

  it("explains which key is missing rather than failing opaquely", () => {
    process.env.OPENAI_API_KEY = "oai";

    expect(() => createSttProvider("deepgram")).toThrow(/DEEPGRAM_API_KEY/);
    expect(() => new DeepgramSttProvider("")).toThrow(/required/);
    expect(() => new WhisperSttProvider("")).toThrow(/required/);
  });

  it("throws when nothing is configured", () => {
    expect(() => createSttProvider(null)).toThrow(/No STT provider configured/);
  });

  it("reports availability without constructing anything", () => {
    expect(availableSttProviders()).toEqual([]);
    process.env.OPENAI_API_KEY = "oai";
    expect(availableSttProviders()).toEqual(["whisper"]);
    process.env.DEEPGRAM_API_KEY = "dg";
    expect(availableSttProviders()).toEqual(["deepgram", "whisper"]);
  });
});

describe("WhisperSttProvider session", () => {
  it("ignores pushed frames, since it cannot consume a live stream", async () => {
    const session = await new WhisperSttProvider("key").open({ sampleRate: 24_000 });

    expect(() => session.push(Buffer.alloc(480))).not.toThrow();
    // No frames handed to finalize means no request and no cost.
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
    // Byte rate and block align must match 16-bit mono or decoders mis-read speed.
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
