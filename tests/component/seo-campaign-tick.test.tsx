import { describe, it, expect } from "vitest";
import {
  computeAutoSeoDecision,
  topicsOverlap,
  weekStartIso,
  AUTO_SEO_NAME_PREFIX,
} from "@/lib/growthmind/seo-campaign-tick";

const now = new Date("2026-08-04T10:00:00Z"); // Tuesday

describe("computeAutoSeoDecision", () => {
  it("disabled when perWeek <= 0", () => {
    expect(computeAutoSeoDecision({ perWeek: 0, createdThisWeek: 0, lastAutoCreatedAt: null, now }).create).toBe(false);
    expect(computeAutoSeoDecision({ perWeek: -3, createdThisWeek: 0, lastAutoCreatedAt: null, now }).create).toBe(false);
  });

  it("stops at the weekly quota", () => {
    const r = computeAutoSeoDecision({ perWeek: 2, createdThisWeek: 2, lastAutoCreatedAt: "2026-08-03T00:00:00Z", now });
    expect(r).toEqual({ create: false, reason: "weekly_quota_reached" });
  });

  it("enforces the minimum gap between auto campaigns (2/week => 3 days)", () => {
    const tooSoon = computeAutoSeoDecision({
      perWeek: 2, createdThisWeek: 1,
      lastAutoCreatedAt: "2026-08-02T10:00:00Z", // 2 days ago
      now,
    });
    expect(tooSoon).toEqual({ create: false, reason: "min_gap_not_elapsed" });

    const due = computeAutoSeoDecision({
      perWeek: 2, createdThisWeek: 1,
      lastAutoCreatedAt: "2026-08-01T09:00:00Z", // >3 days ago
      now,
    });
    expect(due.create).toBe(true);
  });

  it("creates immediately when no auto campaign exists yet", () => {
    expect(computeAutoSeoDecision({ perWeek: 2, createdThisWeek: 0, lastAutoCreatedAt: null, now }).create).toBe(true);
  });

  it("clamps perWeek to a sane maximum (never more than daily)", () => {
    const r = computeAutoSeoDecision({
      perWeek: 100, createdThisWeek: 7,
      lastAutoCreatedAt: "2026-08-04T09:00:00Z", now,
    });
    expect(r.create).toBe(false); // 7 already this week even at max cadence
  });
});

describe("weekStartIso", () => {
  it("returns Monday UTC for a mid-week date", () => {
    expect(weekStartIso(new Date("2026-08-04T10:00:00Z"))).toBe("2026-08-03T00:00:00.000Z");
  });
  it("returns previous Monday for a Sunday", () => {
    expect(weekStartIso(new Date("2026-08-09T23:00:00Z"))).toBe("2026-08-03T00:00:00.000Z");
  });
});

describe("topicsOverlap", () => {
  it("detects overlapping topics", () => {
    expect(topicsOverlap("[Auto] missed calls ai receptionist", "ai receptionist for missed calls")).toBe(true);
  });
  it("passes distinct topics", () => {
    expect(topicsOverlap("voicemail transcription pricing", "whatsapp booking automation")).toBe(false);
  });
  it("ignores short/stop words", () => {
    expect(topicsOverlap("how to win", "how to lose")).toBe(false);
  });
});

describe("auto name prefix", () => {
  it("is stable (cadence counting depends on it)", () => {
    expect(AUTO_SEO_NAME_PREFIX).toBe("[Auto] ");
  });
});
