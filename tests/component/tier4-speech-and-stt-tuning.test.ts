/**
 * Tier 4 parity settings: normalizeForSpeech, pronunciationDictionary, enableDynamicVoiceSpeed,
 * enableDynamicResponsiveness, and sttMode/vocabSpecialization — all previously stored by the
 * builder and read by nobody on a native call.
 */
import { describe, expect, it } from "vitest";
import { normalizeForSpeech } from "@/lib/voice/tts/speech-normalization.shared";
import { applyPronunciationDictionary } from "@/lib/voice/tts/pronunciation-dictionary.shared";
import { resolveDynamicSpeed } from "@/lib/voice/tts/dynamic-voice-speed.shared";
import { resolveDynamicSilenceTimeoutMs } from "@/lib/voice/lifecycle/dynamic-responsiveness.shared";
import { resolveDeepgramModel } from "@/lib/voice/stt/stt-tuning.shared";

describe("normalizeForSpeech", () => {
  it("leaves text untouched when the toggle is off or unset", () => {
    expect(normalizeForSpeech("It costs $12 and Dr. Lee agrees", {})).toBe(
      "It costs $12 and Dr. Lee agrees",
    );
    expect(normalizeForSpeech("$12", null)).toBe("$12");
  });

  it("spells out currency, percent, ampersand, and abbreviations when enabled", () => {
    const settings = { normalizeForSpeech: true };
    expect(normalizeForSpeech("It costs $12.50", settings)).toBe("It costs 12.50 dollars");
    expect(normalizeForSpeech("5% off", settings)).toBe("5 percent off");
    expect(normalizeForSpeech("Smith & Sons", settings)).toBe("Smith and Sons");
    expect(normalizeForSpeech("Dr. Lee on St. Mary", settings)).toBe("Doctor Lee on Street Mary");
  });

  it("does not spell out plain digit strings like phone numbers", () => {
    expect(normalizeForSpeech("Call 07911 123456", { normalizeForSpeech: true })).toBe(
      "Call 07911 123456",
    );
  });
});

describe("applyPronunciationDictionary", () => {
  it("substitutes whole-word, case-insensitively", () => {
    const out = applyPronunciationDictionary("Xero is great, xero really is", [
      { word: "Xero", alphabet: "respell", phoneme: "ZEE-ro" },
    ]);
    expect(out).toBe("ZEE-ro is great, ZEE-ro really is");
  });

  it("does not clobber a longer word sharing a shorter entry's letters", () => {
    const out = applyPronunciationDictionary("Adam met Ada", [
      { word: "Ada", alphabet: "respell", phoneme: "AY-da" },
    ]);
    expect(out).toBe("Adam met AY-da");
  });

  it("is a no-op with no entries", () => {
    expect(applyPronunciationDictionary("hello", [])).toBe("hello");
    expect(applyPronunciationDictionary("hello", undefined)).toBe("hello");
  });
});

describe("resolveDynamicSpeed", () => {
  it("returns the base speed unchanged when the toggle is off", () => {
    expect(resolveDynamicSpeed(1, "hi", {})).toBe(1);
    expect(resolveDynamicSpeed(1, "hi", { enableDynamicVoiceSpeed: false })).toBe(1);
  });

  it("speeds up a short line and slows down a long one when enabled", () => {
    const settings = { enableDynamicVoiceSpeed: true };
    expect(resolveDynamicSpeed(1, "Sure thing.", settings)).toBeCloseTo(1.08);
    const longLine = "x".repeat(250);
    expect(resolveDynamicSpeed(1, longLine, settings)).toBeCloseTo(0.95);
  });

  it("leaves a mid-length line at the base speed", () => {
    expect(resolveDynamicSpeed(1, "x".repeat(100), { enableDynamicVoiceSpeed: true })).toBe(1);
  });
});

describe("resolveDynamicSilenceTimeoutMs", () => {
  it("returns the flow-authored timeout unchanged when the toggle is off", () => {
    expect(resolveDynamicSilenceTimeoutMs(5000, [200, 300], {})).toBe(5000);
  });

  it("shortens the wait when the caller has been answering briskly", () => {
    const out = resolveDynamicSilenceTimeoutMs(5000, [300, 400, 500], {
      enableDynamicResponsiveness: true,
    });
    expect(out).toBe(3750);
  });

  it("lengthens the wait when the caller has been slow to respond", () => {
    const out = resolveDynamicSilenceTimeoutMs(5000, [3000, 3200], {
      enableDynamicResponsiveness: true,
    });
    expect(out).toBe(6250);
  });

  it("leaves the timeout unchanged for a middling pace, or with no history yet", () => {
    expect(
      resolveDynamicSilenceTimeoutMs(5000, [1500], { enableDynamicResponsiveness: true }),
    ).toBe(5000);
    expect(resolveDynamicSilenceTimeoutMs(5000, [], { enableDynamicResponsiveness: true })).toBe(
      5000,
    );
  });
});

describe("resolveDeepgramModel", () => {
  it("returns undefined (provider default) when nothing is configured", () => {
    expect(resolveDeepgramModel({})).toBeUndefined();
    expect(resolveDeepgramModel(null)).toBeUndefined();
  });

  it("maps vocabSpecialization: medical to the medical model, ahead of sttMode", () => {
    expect(resolveDeepgramModel({ vocabSpecialization: "medical", sttMode: "fast" })).toBe(
      "nova-2-medical",
    );
  });

  it("maps sttMode fast/accurate/custom to Deepgram's real model names", () => {
    expect(resolveDeepgramModel({ sttMode: "fast" })).toBe("base");
    expect(resolveDeepgramModel({ sttMode: "accurate" })).toBe("nova-2");
    expect(resolveDeepgramModel({ sttMode: "custom" })).toBe("nova-2");
  });
});
