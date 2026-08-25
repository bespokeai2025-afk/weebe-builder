import { describe, expect, it } from "vitest";

import { resolveCascadeTuning } from "@/lib/voice/cascade-tuning.shared";
import {
  resolveWebeeSpeechModel,
  WEBEE_NATIVE_SPEECH_MODEL,
} from "@/lib/voice/webee-native.shared";
import {
  buildLanguageLockInstruction,
  isEnglishOnlyAgent,
  isLikelyEnglishSttHallucination,
  isMostlyNonLatinScript,
  normalizeEnglishLockedSttText,
  resolveSttLanguageCode,
  romanizeForEnglishStt,
} from "@/lib/voice/language-lock.shared";

describe("language lock", () => {
  it("locks English agents to English only", () => {
    const instruction = buildLanguageLockInstruction(["en-US"]);
    expect(instruction).toContain("ONLY in English");
    expect(instruction).toContain("Latin letters");
    expect(instruction).not.toContain("repeat in English");
    expect(isEnglishOnlyAgent(["en-US"])).toBe(true);
  });

  it("detects non-Latin STT output", () => {
    expect(isMostlyNonLatinScript("आरजो")).toBe(true);
    expect(isMostlyNonLatinScript("Arjo")).toBe(false);
    expect(isMostlyNonLatinScript("Ar jo")).toBe(false);
  });

  it("drops Fish hallucinations and romanizes Indic script for English STT", () => {
    expect(isLikelyEnglishSttHallucination("嗯。")).toBe(true);
    expect(normalizeEnglishLockedSttText("嗯。", "en")).toBe("");
    expect(normalizeEnglishLockedSttText("आर जो", "en")).toBe("ar jo");
    expect(normalizeEnglishLockedSttText("हेलो हेलो", "en")).toBe("hello hello");
    expect(normalizeEnglishLockedSttText("哈喽，哈喽", "en")).toBe("hello");
    expect(normalizeEnglishLockedSttText("Arjo", "en")).toBe("Arjo");
    expect(normalizeEnglishLockedSttText("yes please", "en")).toBe("yes please");
  });

  it("romanizes common mis-detected greetings and names", () => {
    expect(romanizeForEnglishStt("आर जो")).toBe("ar jo");
    expect(romanizeForEnglishStt("हेलो")).toBe("hello");
    expect(romanizeForEnglishStt("哈喽")).toBe("hello");
  });

  it("maps en-US to Whisper language en", () => {
    expect(resolveSttLanguageCode(["en-US"])).toBe("en");
  });

  it("skips hard lock for multilingual flex mode", () => {
    const instruction = buildLanguageLockInstruction(["multi"]);
    expect(instruction).not.toContain("ONLY in English");
    expect(resolveSttLanguageCode(["multi"])).toBeUndefined();
  });
});

describe("WEBEE Native speech model", () => {
  it("defaults to gpt-4o-mini when unset or legacy gpt-4.1", () => {
    expect(resolveWebeeSpeechModel({})).toBe(WEBEE_NATIVE_SPEECH_MODEL);
    expect(resolveWebeeSpeechModel({ model: "gpt-4.1" })).toBe(WEBEE_NATIVE_SPEECH_MODEL);
  });

  it("honours an explicit non-default model", () => {
    expect(resolveWebeeSpeechModel({ model: "gpt-4.1-mini" })).toBe("gpt-4.1-mini");
  });
});

describe("resolveTextModel", () => {
  it("passes through gpt-4o-mini instead of upgrading to gpt-4.1", async () => {
    const { resolveTextModel } = await import("@/lib/voice/llm/gpt");
    expect(resolveTextModel("gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(resolveTextModel("gpt-4o")).toBe("gpt-4o");
  });
});

describe("routing heuristics", () => {
  it("skips classifier for obvious yes/no and short names", async () => {
    const { tryHeuristicEdgeIndex, looksLikePhoneAnswer } = await import("@/lib/voice/graph/router");
    expect(
      tryHeuristicEdgeIndex(["caller says yes", "caller says no"], "yes"),
    ).toBe(0);
    expect(
      tryHeuristicEdgeIndex(["caller gives their name", "caller refuses"], "Arjo"),
    ).toBe(0);
    expect(looksLikePhoneAnswer("Double nine six four nine one nine triple zero.")).toBe(true);
    expect(
      tryHeuristicEdgeIndex(
        ["caller provides phone number", "caller refuses"],
        "Double nine six four nine one nine triple zero.",
      ),
    ).toBe(0);
  });
});

describe("structured routing output", () => {
  it("parses JSON transition numbers and labels", async () => {
    const { parseTransitionIndex } = await import("@/lib/voice/graph/llm");
    expect(parseTransitionIndex('{"transition": 2}', ["a", "b", "c"])).toBe(1);
    expect(parseTransitionIndex('{"transition": "positive"}', ["negative path", "positive path"])).toBe(1);
    expect(parseTransitionIndex('{"transition": 0}', ["a"])).toBe(-1);
  });
});

describe("cascade tuning", () => {
  it("uses faster endpointing when responsiveness is high", () => {
    const fast = resolveCascadeTuning({ responsiveness: 1.5 });
    const slow = resolveCascadeTuning({ responsiveness: 0.5 });
    expect(fast.vad.silenceFramesTrigger!).toBeLessThan(slow.vad.silenceFramesTrigger!);
    expect(fast.silenceDurationMs).toBeLessThan(slow.silenceDurationMs);
  });

  it("lowers barge-in threshold when interruption sensitivity is high", () => {
    const sensitive = resolveCascadeTuning({ interruptionSensitivity: 0.9 });
    const guarded = resolveCascadeTuning({ interruptionSensitivity: 0.2 });
    expect(sensitive.bargeInSpeechFrames).toBeLessThan(guarded.bargeInSpeechFrames);
  });
});
