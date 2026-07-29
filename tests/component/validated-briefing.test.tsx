// ── Validated Business Briefing — regression tests against the spec ──────────
// Acceptance tests from the briefing-upgrade spec:
//  1. 159/380 → 41.8%           2. contradictory totals flagged
//  3. missing financials never £0   5. unclassified sentiment identified
//  7/8. voice output natural, no markdown, no long lists, ~80–160 words
import { describe, expect, it } from "vitest";
import {
  buildScreenSummary,
  buildVoiceSummary,
  checkRateClaim,
  countMetric,
  countWords,
  joinNatural,
  rateMetric,
  ratePct,
  sentimentUnknownCount,
  stripMarkdownForVoice,
  validateCallBreakdown,
} from "@/lib/hivemind/validated-briefing.shared";

describe("ratePct", () => {
  it("reports 159 of 380 as 41.8 (spec acceptance test 1)", () => {
    expect(ratePct(159, 380)).toBe(41.8);
  });
  it("returns null (never 0) when the denominator is missing", () => {
    expect(ratePct(5, 0)).toBeNull();
    expect(ratePct(5, -1)).toBeNull();
    expect(ratePct(NaN, 10)).toBeNull();
  });
  it("rounds to one decimal", () => {
    expect(ratePct(1, 3)).toBe(33.3);
    expect(ratePct(2, 3)).toBe(66.7);
    expect(ratePct(1, 1)).toBe(100);
  });
});

describe("rateMetric provenance", () => {
  it("carries numerator, denominator, formula, source and time range", () => {
    const m = rateMetric({
      key: "connection_rate", label: "Connection rate",
      numerator: 159, denominator: 380,
      formula: "connected ÷ total calls × 100",
      source: "wbah_calls", timeRange: "today (Europe/London)",
    });
    expect(m).not.toBeNull();
    expect(m!.value).toBe(41.8);
    expect(m!.numerator).toBe(159);
    expect(m!.denominator).toBe(380);
    expect(m!.formula).toContain("÷");
    expect(m!.source).toBe("wbah_calls");
    expect(m!.timeRange).toContain("today");
  });
  it("returns null instead of a fabricated rate when the denominator is 0", () => {
    expect(rateMetric({ key: "x", label: "x", numerator: 3, denominator: 0, formula: "f", source: "s", timeRange: "t" })).toBeNull();
  });
});

describe("checkRateClaim", () => {
  it("flags a 65.5% claim when the real rate is 41.8% (spec example)", () => {
    const w = checkRateClaim(65.5, 159, 380, "Connection rate");
    expect(w).not.toBeNull();
    expect(w!.severity).toBe("critical");
    expect(w!.message).toContain("41.8");
  });
  it("accepts a matching claim", () => {
    expect(checkRateClaim(41.8, 159, 380, "Connection rate")).toBeNull();
  });
});

describe("validateCallBreakdown (spec acceptance test 2)", () => {
  it("flags the connected+voicemail=total but failed>0 overlap", () => {
    const ws = validateCallBreakdown({ total: 380, connected: 159, voicemail: 221, failed: 55, source: "wbah_calls" });
    expect(ws.some((w) => w.code === "call_failed_overlap")).toBe(true);
    expect(ws.find((w) => w.code === "call_failed_overlap")!.message).toContain("reporting mismatch");
  });
  it("flags categories exceeding the total", () => {
    const ws = validateCallBreakdown({ total: 100, connected: 80, voicemail: 40, failed: 0, source: "calls" });
    expect(ws.some((w) => w.code === "call_categories_exceed_total")).toBe(true);
  });
  it("counts unclassified records", () => {
    const ws = validateCallBreakdown({ total: 100, connected: 50, voicemail: 20, failed: 10, source: "calls" });
    const w = ws.find((x) => x.code === "call_unclassified");
    expect(w).toBeDefined();
    expect(w!.message).toContain("20 of 100");
  });
  it("stays silent on a clean breakdown", () => {
    expect(validateCallBreakdown({ total: 100, connected: 60, voicemail: 40, failed: 0, source: "calls" })).toHaveLength(0);
  });
});

describe("sentimentUnknownCount (spec acceptance test 5)", () => {
  it("identifies unclassified records", () => {
    expect(sentimentUnknownCount({ total: 380, positive: 6, neutral: 100, negative: 20 })).toBe(254);
    expect(sentimentUnknownCount({ total: 10, positive: 5, neutral: 3, negative: 2 })).toBe(0);
  });
});

describe("voice summary (spec acceptance tests 7 & 8)", () => {
  const facts = {
    assessment: "Today was busy, but the results were weaker than the activity level suggests — 380 calls, 159 reaching a person.",
    wentWell: ["the dialler handled 380 calls today", "6 calls qualified today"],
    underperformed: ["qualified calls produced no bookings today — 6 calls were marked qualified but none produced a booking"],
    dataWarnings: ["connected calls and voicemails already account for all 380 calls, while 55 failed calls are also reported"],
    topActions: [
      "Create an immediate follow-up queue for the 6 qualified calls",
      "Investigate the conflicting call-outcome figures",
      "Retry voicemail outcomes during alternative calling windows",
    ],
    closingQuestion: "Should I investigate the reporting issue first, or start the qualified-lead follow-ups?",
  };

  it("produces natural text with no markdown and a closing question", () => {
    const v = buildVoiceSummary(facts);
    expect(v).not.toMatch(/[*_#`|]/);
    expect(v.trim().endsWith("?")).toBe(true);
    expect(v).toContain("The main concern");
  });

  it("stays within the ~160 word budget even with oversized inputs", () => {
    const long = {
      ...facts,
      wentWell: Array.from({ length: 10 }, (_, i) => `positive thing number ${i} with quite a lot of additional descriptive words attached to it`),
      underperformed: Array.from({ length: 10 }, (_, i) => `negative thing number ${i} with quite a lot of additional descriptive words attached to it`),
      dataWarnings: Array.from({ length: 10 }, (_, i) => `warning number ${i} with quite a lot of additional descriptive words attached to it as well`),
      topActions: Array.from({ length: 10 }, (_, i) => `Action number ${i} with a very long descriptive title that goes on and on`),
    };
    const v = buildVoiceSummary(long);
    expect(countWords(v)).toBeLessThanOrEqual(160);
    // Lists are truncated, never read in full (max 2+2+2+3 items used).
    expect(v).not.toContain("positive thing number 5");
  });

  it("keeps the assessment and closing question when trimming", () => {
    const v = buildVoiceSummary(facts);
    expect(v.startsWith("Today was busy")).toBe(true);
    expect(v).toContain("Should I investigate");
  });
});

describe("stripMarkdownForVoice", () => {
  it("removes markdown artifacts", () => {
    expect(stripMarkdownForVoice("**Bold** and _em_ and `code` and [link](http://x)")).toBe("Bold and em and code and link");
  });
});

describe("screen summary", () => {
  const core = {
    workspaceId: "ws1",
    generatedAt: new Date("2026-07-28T08:00:00Z").toISOString(),
    reportingPeriod: { label: "today", from: "", to: "", timezone: "Europe/London" },
    dataSources: ["wbah_calls"],
    sourceFreshness: [],
    verifiedMetrics: [
      rateMetric({ key: "conn", label: "Connection rate", numerator: 159, denominator: 380, formula: "connected ÷ total × 100", source: "wbah_calls", timeRange: "today" })!,
      countMetric({ key: "agents_deployed", label: "Deployed agents", value: 9, source: "agents table", timeRange: "current" }),
      countMetric({ key: "agents_draft", label: "Draft (undeployed) agents", value: 3, source: "agents table", timeRange: "current", note: "drafts: Conversation Flow Agent, Alex, Clare" }),
    ],
    unverifiedMetrics: [
      { key: "revenue", label: "Revenue", reason: "financial performance could not be confirmed from the currently connected data", source: "AccountsMind" },
    ],
    dataWarnings: [{ code: "x", severity: "warning" as const, message: "A reporting mismatch was found." }],
    positiveOutcomes: ["6 calls qualified today"],
    commercialRisks: [{ rank: 1, title: "No bookings", detail: "Qualified calls produced no bookings." }],
    recommendedActions: [],
  };

  it("shows every KPI with traceable provenance (spec acceptance test 10)", () => {
    const s = buildScreenSummary(core);
    expect(s).toContain("Connection rate: 41.8%");
    expect(s).toContain("(159 ÷ 380)");
    expect(s).toContain("wbah_calls");
  });

  it("reports deployed and draft agents separately (spec acceptance test 6)", () => {
    const s = buildScreenSummary(core);
    expect(s).toContain("Deployed agents: 9");
    expect(s).toContain("Draft (undeployed) agents: 3");
    expect(s).toContain("Conversation Flow Agent");
  });

  it("never renders missing financials as £0 (spec acceptance test 3)", () => {
    const s = buildScreenSummary(core);
    expect(s).not.toContain("£0");
    expect(s).toContain("could not be confirmed");
    expect(s).toContain("unavailable, not zero");
  });
});

describe("voice and screen derive from the same validated object (spec acceptance test 12)", () => {
  it("both outputs carry the same verified figures", () => {
    const conn = rateMetric({ key: "conn", label: "Connection rate", numerator: 159, denominator: 380, formula: "connected ÷ total × 100", source: "wbah_calls", timeRange: "today" })!;
    const core = {
      workspaceId: "ws1",
      generatedAt: new Date().toISOString(),
      reportingPeriod: { label: "today", from: "", to: "", timezone: "Europe/London" },
      dataSources: ["wbah_calls"],
      sourceFreshness: [],
      verifiedMetrics: [conn],
      unverifiedMetrics: [],
      dataWarnings: [],
      positiveOutcomes: [],
      commercialRisks: [],
      recommendedActions: [],
    };
    const screen = buildScreenSummary(core);
    const voice = buildVoiceSummary({
      assessment: `Connection rate today was ${conn.value} percent — ${conn.numerator} of ${conn.denominator} calls reached a person.`,
      wentWell: [], underperformed: [], dataWarnings: [], topActions: [],
      closingQuestion: "Anything you want me to dig into?",
    });
    // Same numerator/denominator/rate appear in both renderings.
    expect(screen).toContain("41.8%");
    expect(screen).toContain("(159 ÷ 380)");
    expect(voice).toContain("41.8");
    expect(voice).toContain("159");
    expect(voice).toContain("380");
  });
});

describe("joinNatural", () => {
  it("joins naturally", () => {
    expect(joinNatural(["a"])).toBe("a");
    expect(joinNatural(["a", "b"])).toBe("a and b");
    expect(joinNatural(["a", "b", "c"])).toBe("a, b and c");
  });
});
