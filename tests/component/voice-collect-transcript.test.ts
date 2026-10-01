import { describe, expect, it } from "vitest";

import { shouldCaptureCollectAnswer } from "@/lib/voice/graph/collect-variable.shared";
import {
  splitSpokenSentences,
  transcriptCaughtUpToAudio,
} from "@/lib/voice/graph/spoken-transcript.shared";
import { findRegisteredTool } from "@/lib/runtime/tool-executor";

describe("shouldCaptureCollectAnswer", () => {
  it("skips greetings, yes/no and questions — not worth an extraction call", () => {
    expect(shouldCaptureCollectAnswer("hello")).toBe(false);
    expect(shouldCaptureCollectAnswer("oke")).toBe(false);
    expect(shouldCaptureCollectAnswer("what?")).toBe(false);
    expect(shouldCaptureCollectAnswer("Mrs")).toBe(true);
    expect(shouldCaptureCollectAnswer("SW1A 1AA")).toBe(true);
  });
});

describe("spoken transcript catch-up", () => {
  it("splits a pitch into sentences", () => {
    expect(
      splitSpokenSentences("Hello there. Does that sound ok? Great."),
    ).toEqual(["Hello there.", "Does that sound ok?", "Great."]);
  });

  it("reveals whole sentences as audio duration grows", () => {
    const full = "Hello there. Does that sound ok?";
    expect(transcriptCaughtUpToAudio(full, 0, 24000)).toBe("");
    const first = transcriptCaughtUpToAudio(full, 24000 * 2 * 1, 24000);
    expect(first).toBe("Hello there.");
    expect(transcriptCaughtUpToAudio(full, 24000 * 2 * 20, 24000)).toBe(full);
  });

  it("does not dump a long greeting from a 0.4s first audio chunk", () => {
    const full =
      "Hi, this is Clare calling from We Buy Any House. Is selling your property still something you're thinking about?";
    const shown = transcriptCaughtUpToAudio(full, 18806, 24000);
    expect(shown.length).toBeLessThan(40);
    expect(shown).not.toContain("thinking about");
  });
});

describe("findRegisteredTool", () => {
  const tools = [
    {
      name: "check_availability",
      tool_id: "check_availability_cal",
      type: "check_availability_cal",
    },
    { name: "Get Available Slots ", tool_id: "tool-1" },
  ];

  it("matches Retell native type, trimmed name, and tool_id", () => {
    expect(findRegisteredTool(tools, "Get Available Slots", "check_availability_cal")?.name).toBe(
      "check_availability",
    );
    expect(findRegisteredTool(tools, "check_availability_cal")?.name).toBe("check_availability");
    expect(findRegisteredTool(tools, "Get Available Slots ")?.name).toBe("Get Available Slots ");
  });
});
