/**
 * OpenAI TTS provider.
 *
 * The endpoint returns PCM16 mono at a fixed 24 kHz, but the provider contract is "PCM16 at the
 * requested rate". Telephony asks for 8 kHz, and handing it 24 kHz audio unchanged would play the
 * whole call at three times speed — so the resampling is the part worth pinning down.
 */
import { describe, expect, it } from "vitest";
import {
  resamplePcm16,
  resolveOpenAiTtsModel,
  resolveOpenAiTtsVoice,
} from "@/lib/voice/tts/openai.provider";
import { OPENAI_TTS_VOICES } from "@/lib/voice/tts/openai-voices.shared";

/** PCM16 buffer from sample values. */
const pcm = (samples: number[]): Buffer => {
  const b = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => b.writeInt16LE(s, i * 2));
  return b;
};
const samplesOf = (b: Buffer): number[] =>
  Array.from({ length: b.byteLength / 2 }, (_, i) => b.readInt16LE(i * 2));

describe("resolveOpenAiTtsVoice", () => {
  it("accepts every documented voice", () => {
    for (const v of OPENAI_TTS_VOICES) expect(resolveOpenAiTtsVoice(v)).toBe(v);
  });

  it("falls back rather than sending a Fish or ElevenLabs id", () => {
    // These would 400 mid-call; a default voice is recoverable, a failed turn is not.
    expect(resolveOpenAiTtsVoice("b4f5a1c2d3e4f5a6b7c8d9e0")).toBe("alloy");
    expect(resolveOpenAiTtsVoice("11labs-Adrian")).toBe("alloy");
    expect(resolveOpenAiTtsVoice(null)).toBe("alloy");
  });

  it("is case-insensitive", () => {
    expect(resolveOpenAiTtsVoice("NOVA")).toBe("nova");
  });
});

describe("resolveOpenAiTtsModel", () => {
  it("defaults to gpt-4o-mini-tts", () => {
    expect(resolveOpenAiTtsModel(null)).toBe("gpt-4o-mini-tts");
    expect(resolveOpenAiTtsModel("  ")).toBe("gpt-4o-mini-tts");
  });
  it("honours an override", () => {
    expect(resolveOpenAiTtsModel("tts-1-hd")).toBe("tts-1-hd");
  });
});

describe("resamplePcm16", () => {
  it("returns the input untouched when the rate already matches", () => {
    const b = pcm([1, 2, 3, 4]);
    expect(resamplePcm16(b, 24000, 24000)).toBe(b);
  });

  it("decimates 24 kHz to 8 kHz at exactly one third the samples", () => {
    const input = pcm(Array.from({ length: 300 }, (_, i) => i * 100));
    const out = resamplePcm16(input, 24000, 8000);
    expect(out.byteLength / 2).toBe(100);
  });

  it("takes every third sample on that exact 3:1 ratio", () => {
    const input = pcm([0, 111, 222, 333, 444, 555, 666, 777, 888]);
    expect(samplesOf(resamplePcm16(input, 24000, 8000))).toEqual([0, 333, 666]);
  });

  it("upsamples without clipping or overflowing int16", () => {
    const input = pcm([-32768, 32767, -32768, 32767]);
    const out = resamplePcm16(input, 8000, 24000);
    expect(out.byteLength / 2).toBe(12);
    for (const s of samplesOf(out)) {
      expect(s).toBeGreaterThanOrEqual(-32768);
      expect(s).toBeLessThanOrEqual(32767);
    }
  });

  it("always emits whole samples", () => {
    for (const rate of [8000, 16000, 22050, 24000]) {
      const out = resamplePcm16(pcm(Array.from({ length: 97 }, (_, i) => i)), 24000, rate);
      expect(out.byteLength % 2).toBe(0);
    }
  });

  it("handles a buffer too short to hold one sample", () => {
    expect(resamplePcm16(Buffer.alloc(1), 24000, 8000).byteLength).toBeLessThanOrEqual(2);
  });
});
