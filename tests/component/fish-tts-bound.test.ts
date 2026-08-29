import { describe, expect, it } from "vitest";
import {
  buildStartRequest,
  expectedPcmBytesForText,
  FISH_BOUND_KEEP_ALIVE,
  FISH_CLONE_MIN_CHUNK_LENGTH,
  FISH_STREAM_FIRST_FLUSH_CHARS,
  shouldEndFishLiveUtterance,
  shouldFlushFishLiveBuffer,
} from "@/lib/voice/tts/fish.provider";

/**
 * Regression guard: bound-call TTS must always emit the same locked reference_id
 * and keep the live socket across utterances (flush, no stop).
 */
describe("fish-tts bound call", () => {
  const lockedProfile = {
    voiceId: "164a9e442b984c3aa3fa8a21fd29a10c",
    sampleRate: 24000,
    temperature: 0.4,
    speed: 1.12,
    latency: "low" as const,
  };

  it("buildStartRequest uses locked reference_id and stability flags on every utterance", () => {
    const req = buildStartRequest(lockedProfile);
    expect(req.reference_id).toBe(lockedProfile.voiceId);
    expect(req.temperature).toBe(0.4);
    expect(req.top_p).toBe(0.5);
    expect(req.chunk_length).toBe(200);
    expect(req.min_chunk_length).toBe(FISH_CLONE_MIN_CHUNK_LENGTH);
    expect(FISH_CLONE_MIN_CHUNK_LENGTH).toBe(FISH_STREAM_FIRST_FLUSH_CHARS);
    expect(FISH_BOUND_KEEP_ALIVE).toBe(true);
    expect(req.prosody).toEqual({ speed: 1.12, normalize_loudness: true });
    expect(req.condition_on_previous_chunks).toBe(true);
    expect(req.normalize).toBe(true);
  });

  it("identical profile produces identical start payloads across utterances", () => {
    const a = buildStartRequest(lockedProfile);
    const b = buildStartRequest({ ...lockedProfile });
    expect(a).toEqual(b);
    expect(a.references).toBeUndefined();
  });

  it("attaches in-call greeting audio as Fish references only for owned clones", () => {
    const wav = Buffer.from("RIFF");
    const library = buildStartRequest(lockedProfile, {
      wav,
      text: "Hi, this is Clare calling.",
    });
    expect(library.references).toBeUndefined();

    const clone = buildStartRequest(
      { ...lockedProfile, cloneVoice: true },
      { wav, text: "Hi, this is Clare calling." },
    );
    expect(clone.reference_id).toBe(lockedProfile.voiceId);
    expect(Array.isArray(clone.references)).toBe(true);
    const refs = clone.references as Array<{ audio: Uint8Array; text: string }>;
    expect(refs[0]?.text).toBe("Hi, this is Clare calling.");
    expect(refs[0]?.audio.byteLength).toBe(wav.byteLength);
  });
});

describe("Fish live utterance idle-end", () => {
  it("does not end a long greeting after the first 0.4s audio burst", () => {
    const greeting =
      "Hi, this is Clare calling from We Buy Any House. Is selling your property still something you're thinking about?";
    expect(
      shouldEndFishLiveUtterance({
        gotAudio: true,
        idleMs: 280,
        pcmBytes: 18806,
        expectedText: greeting,
        sampleRate: 24000,
      }),
    ).toBe(false);
    expect(
      shouldEndFishLiveUtterance({
        gotAudio: true,
        idleMs: 900,
        pcmBytes: 18806,
        expectedText: greeting,
        sampleRate: 24000,
      }),
    ).toBe(false);
  });

  it("ends once coverage is high and audio has been idle", () => {
    expect(
      shouldEndFishLiveUtterance({
        gotAudio: true,
        idleMs: 900,
        pcmBytes: expectedPcmBytesForText("Hello there.", 24000),
        expectedText: "Hello there.",
        sampleRate: 24000,
      }),
    ).toBe(true);
  });
});

describe("Fish live first-audio flush", () => {
  it("flushes the first phrase well before a full sentence", () => {
    expect(shouldFlushFishLiveBuffer("Thank you, ", false)).toBe(true);
    expect(shouldFlushFishLiveBuffer("Hi there friend", false)).toBe(true);
    expect(shouldFlushFishLiveBuffer("Yes.", false)).toBe(false);
    expect(shouldFlushFishLiveBuffer("Great, ok.", false)).toBe(true);
  });

  it("does not wait for a 40-character sentence before first audio", () => {
    expect(shouldFlushFishLiveBuffer("Can I take your", false)).toBe(true);
    expect(shouldFlushFishLiveBuffer("Th", false)).toBe(false);
  });

  it("after the first flush, waits for a real sentence", () => {
    expect(shouldFlushFishLiveBuffer("name please", true)).toBe(false);
    expect(shouldFlushFishLiveBuffer("Could I take your full name please?", true)).toBe(true);
  });
});
