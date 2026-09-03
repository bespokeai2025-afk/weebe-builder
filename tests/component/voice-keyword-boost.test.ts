import { describe, expect, it } from "vitest";

import {
  applyKeywordBoost,
  keywordBoostPrompt,
} from "@/lib/voice/stt/keyword-boost.shared";
import { nativeCascadeOptionsFromSettings } from "@/lib/voice/gateway/telephony-core";

describe("keywordBoostPrompt", () => {
  it("joins unique trimmed terms for the Fish transcription prompt", () => {
    expect(keywordBoostPrompt([" Jumeirah ", "Dubai", "dubai", ""])).toBe("Jumeirah, Dubai");
    expect(keywordBoostPrompt([])).toBeUndefined();
  });
});

describe("applyKeywordBoost", () => {
  it("corrects a near-miss token to the boosted keyword", () => {
    expect(applyKeywordBoost("It's in Jumeira village", ["Jumeirah"])).toBe(
      "It's in Jumeirah village",
    );
  });

  it("corrects a multi-word keyword", () => {
    expect(applyKeywordBoost("Arabian Ranchs 3 please", ["Arabian Ranches"])).toBe(
      "Arabian Ranches 3 please",
    );
  });

  it("leaves unrelated words alone", () => {
    expect(applyKeywordBoost("yes I am the owner", ["Jumeirah", "viewing"])).toBe(
      "yes I am the owner",
    );
  });
});

describe("nativeCascadeOptionsFromSettings", () => {
  it("reads builder speech fields used on a live native call", () => {
    expect(
      nativeCascadeOptionsFromSettings({
        boostedKeywords: ["JVC", ""],
        speechLanguages: ["en-US"],
        hyperstreamSilenceDurationMs: 400,
        responsiveness: 1.2,
        interruptionSensitivity: 0.9,
      }),
    ).toEqual({
      boostedKeywords: ["JVC"],
      speechLanguages: ["en-US"],
      silenceDurationMs: 400,
      responsiveness: 1.2,
      interruptionSensitivity: 0.9,
    });
  });
});
