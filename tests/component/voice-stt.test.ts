import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FishSttProvider,
  availableSttProviders,
  buildWav,
  createSttProvider,
  resolveWebeeSttPreference,
} from "@/lib/voice/stt";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.FISH_API_KEY;
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

  it("throws when FISH_API_KEY is missing", () => {
    expect(() => createSttProvider(null)).toThrow(/FISH_API_KEY/);
    expect(() => new FishSttProvider("")).toThrow(/API key/);
  });

  it("reports availability without constructing anything", () => {
    expect(availableSttProviders()).toEqual([]);
    process.env.FISH_API_KEY = "fish";
    expect(availableSttProviders()).toEqual(["fish"]);
  });
});

describe("resolveWebeeSttPreference", () => {
  it("returns fish when FISH_API_KEY is set", () => {
    process.env.FISH_API_KEY = "fish";
    expect(resolveWebeeSttPreference({})).toBe("fish");
  });

  it("returns null when FISH_API_KEY is missing", () => {
    expect(resolveWebeeSttPreference({})).toBeNull();
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
