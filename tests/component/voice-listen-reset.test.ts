import { describe, expect, it } from "vitest";

import { callerMidUtterance, startedDuringPlayback } from "@/lib/voice/listen-reset.shared";

describe("starting to listen afresh", () => {
  it("keeps a 'yes' the caller is saying as the agent's line ends", () => {
    expect(callerMidUtterance({ callerSpeaking: true, utteranceLoud: true })).toBe(true);
  });

  it("still resets for the agent's own echo (never loud enough to be the caller)", () => {
    expect(callerMidUtterance({ callerSpeaking: true, utteranceLoud: false })).toBe(false);
    expect(callerMidUtterance({ callerSpeaking: false, utteranceLoud: false })).toBe(false);
  });

  it("checks a kept utterance against the agent's words only when it began during playback", () => {
    expect(startedDuringPlayback(1_000, 1_200)).toBe(true);
    expect(startedDuringPlayback(1_300, 1_200)).toBe(false);
    expect(startedDuringPlayback(null, 1_200)).toBe(false);
    expect(startedDuringPlayback(1_000, 0)).toBe(false);
  });
});
