import { describe, it, expect } from "vitest";
import {
  PROJECT_TRANSITIONS,
  canTransition,
  evaluateApprovalRules,
  normalizeApprovalRules,
  DEFAULT_APPROVAL_RULES,
} from "@/lib/growthmind/content-approval.shared";

describe("content project state machine", () => {
  it("supports the fail → retry → publish recovery path", () => {
    // Terminal publish failure moves the project to "failed"…
    expect(canTransition("publishing", "failed")).toBe(true);
    // …manual retry re-queues it as "scheduled" (retryPublishJobNow)…
    expect(canTransition("failed", "scheduled")).toBe(true);
    // …the executor claims it as "publishing" and completes.
    expect(canTransition("scheduled", "publishing")).toBe(true);
    expect(canTransition("publishing", "published")).toBe(true);
  });

  it("supports returning a failed project to production for rework", () => {
    expect(canTransition("failed", "in_production")).toBe(true);
    expect(canTransition("in_production", "awaiting_approval")).toBe(true);
  });

  it("blocks illegal shortcuts around approval", () => {
    expect(canTransition("in_production", "publishing")).toBe(false);
    expect(canTransition("in_production", "published")).toBe(false);
    expect(canTransition("failed", "published")).toBe(false);
    expect(canTransition("published", "publishing")).toBe(false);
  });

  it("every declared transition target is itself a known status", () => {
    for (const [from, tos] of Object.entries(PROJECT_TRANSITIONS)) {
      for (const to of tos) {
        expect(PROJECT_TRANSITIONS, `${from} -> ${to}`).toHaveProperty(to);
      }
    }
  });
});

describe("approval rules", () => {
  const project = (over: Record<string, any> = {}) => ({
    caption: "A nice day at the office",
    script: "hello world",
    media_is_ai: false,
    ...over,
  });

  it("AI media forces approval when the rule is on", () => {
    const ev = evaluateApprovalRules(DEFAULT_APPROVAL_RULES, project({ media_is_ai: true }));
    expect(ev.requiresApproval).toBe(true);
    expect(ev.flags).toContain("ai_media");
  });

  it("claims/pricing language triggers the rule", () => {
    const ev = evaluateApprovalRules(
      DEFAULT_APPROVAL_RULES,
      project({ caption: "Guaranteed results — 50% off this week!" }),
    );
    expect(ev.requiresApproval).toBe(true);
    expect(ev.flags.length).toBeGreaterThan(0);
  });

  it("normalizeApprovalRules falls back to defaults on junk input", () => {
    expect(normalizeApprovalRules(null)).toEqual(DEFAULT_APPROVAL_RULES);
    expect(normalizeApprovalRules("nonsense")).toEqual(DEFAULT_APPROVAL_RULES);
  });
});
