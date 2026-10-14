import { describe, expect, it } from "vitest";
import { shouldNudgeOnEmptyTranscript } from "@/lib/voice/empty-transcript.shared";

describe("shouldNudgeOnEmptyTranscript", () => {
  const now = 1_000_000;
  it("ignores short sounds (breath, click, line noise)", () => {
    expect(shouldNudgeOnEmptyTranscript({ utteranceMs: 700, speechStartAt: now, lastPlaybackEndAt: now - 10_000 })).toBe(false);
  });
  it("ignores sound that starts right as the agent stops (echo of its own voice)", () => {
    expect(shouldNudgeOnEmptyTranscript({ utteranceMs: 2_500, speechStartAt: now, lastPlaybackEndAt: now - 600 })).toBe(false);
  });
  it("asks the caller to repeat when real-length speech was lost", () => {
    expect(shouldNudgeOnEmptyTranscript({ utteranceMs: 2_500, speechStartAt: now, lastPlaybackEndAt: now - 5_000 })).toBe(true);
    expect(shouldNudgeOnEmptyTranscript({ utteranceMs: 2_500, speechStartAt: null, lastPlaybackEndAt: 0 })).toBe(true);
  });
});
