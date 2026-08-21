import { describe, expect, it } from "vitest";
import {
  buildWbahAiTimelineNoteText,
  resolveWbahCallSummaryText,
} from "@/lib/wbah/post-call/wbah-timeline-note.shared";
import { formatWbahRetellCallData } from "@/lib/wbah/post-call/wbah-format-data.shared";

describe("resolveWbahCallSummaryText", () => {
  it("prefers detailed_call_summary over short call_summary", () => {
    expect(
      resolveWbahCallSummaryText(
        { call_summary: "short", detailed_call_summary: "long detailed summary" },
        {},
      ),
    ).toBe("long detailed summary");
  });

  it("falls back to call_analysis.call_summary", () => {
    expect(resolveWbahCallSummaryText({}, { call_summary: "from analysis" })).toBe(
      "from analysis",
    );
  });
});

describe("formatWbahRetellCallData callSummary", () => {
  it("uses detailed_call_summary from custom analysis", () => {
    const formatted = formatWbahRetellCallData({
      dynVars: {},
      custom: { detailed_call_summary: "Full narrative from Retell" },
    });
    expect(formatted.callSummary).toBe("Full narrative from Retell");
  });
});

describe("buildWbahAiTimelineNoteText", () => {
  it("includes summary and transcript excerpt", () => {
    const note = buildWbahAiTimelineNoteText({
      label: "WBAH AI call",
      callId: "call_abc",
      userSentiment: "Neutral",
      callSummary: "Customer requested callback.",
      transcript: "Agent: Hello\nUser: Call me back",
    });
    expect(note).toContain("WBAH AI call — call_id=call_abc — sentiment=Neutral");
    expect(note).toContain("Customer requested callback.");
    expect(note).toContain("Transcript:");
    expect(note).toContain("Call me back");
  });
});