import { describe, expect, it } from "vitest";
import { resolveDynamicSilenceTimeoutMs } from "@/lib/voice/lifecycle/dynamic-responsiveness.shared";

const ON = { enableDynamicResponsiveness: true };

describe("resolveDynamicSilenceTimeoutMs", () => {
  it("is a no-op unless the setting is literally true", () => {
    // Guards against a truthy-but-not-true value (e.g. "true" from a form) silently
    // enabling this for an agent that never opted in.
    expect(resolveDynamicSilenceTimeoutMs(4000, [300], null)).toBe(4000);
    expect(resolveDynamicSilenceTimeoutMs(4000, [300], {})).toBe(4000);
    expect(resolveDynamicSilenceTimeoutMs(4000, [300], { enableDynamicResponsiveness: false })).toBe(4000);
    expect(resolveDynamicSilenceTimeoutMs(4000, [300], { enableDynamicResponsiveness: "true" })).toBe(4000);
    expect(resolveDynamicSilenceTimeoutMs(4000, [300], { enableDynamicResponsiveness: 1 })).toBe(4000);
  });

  it("shortens the wait by 25% for a caller who has been answering briskly", () => {
    // avg 400ms, well under the 800ms brisk threshold.
    expect(resolveDynamicSilenceTimeoutMs(4000, [300, 500], ON)).toBe(3000);
  });

  it("lengthens the wait by 25% for a caller who has been taking their time", () => {
    // avg 3000ms, over the 2500ms slow threshold.
    expect(resolveDynamicSilenceTimeoutMs(4000, [2500, 3500], ON)).toBe(5000);
  });

  it("leaves the authored value alone for a caller pacing in between", () => {
    // avg 1500ms — between the 800ms and 2500ms thresholds.
    expect(resolveDynamicSilenceTimeoutMs(4000, [1000, 2000], ON)).toBe(4000);
  });

  it("treats the thresholds as inclusive at both boundaries", () => {
    expect(resolveDynamicSilenceTimeoutMs(4000, [800], ON)).toBe(3000);
    expect(resolveDynamicSilenceTimeoutMs(4000, [2500], ON)).toBe(5000);
    // Just inside the untouched band on either side.
    expect(resolveDynamicSilenceTimeoutMs(4000, [801], ON)).toBe(4000);
    expect(resolveDynamicSilenceTimeoutMs(4000, [2499], ON)).toBe(4000);
  });

  it("does nothing on the first wait of a call, before any gap has been recorded", () => {
    expect(resolveDynamicSilenceTimeoutMs(4000, [], ON)).toBe(4000);
  });

  it("never invents a wait where the flow specified none", () => {
    expect(resolveDynamicSilenceTimeoutMs(undefined, [300], ON)).toBeUndefined();
    expect(resolveDynamicSilenceTimeoutMs(0, [300], ON)).toBe(0);
  });

  it("keeps the adjustment bounded at ±25% however extreme the caller's pace", () => {
    // A 50ms average does not shorten the wait any further than the 25% floor,
    // and a 60s average does not lengthen it past the 25% ceiling.
    expect(resolveDynamicSilenceTimeoutMs(4000, [10, 20, 30], ON)).toBe(3000);
    expect(resolveDynamicSilenceTimeoutMs(4000, [60000, 60000], ON)).toBe(5000);
  });

  it("rounds to whole milliseconds", () => {
    // 3333 * 0.75 = 2499.75
    expect(resolveDynamicSilenceTimeoutMs(3333, [100], ON)).toBe(2500);
    expect(Number.isInteger(resolveDynamicSilenceTimeoutMs(3333, [100], ON))).toBe(true);
  });
});

// Note: the reminder-reaffirmation skip is caller-side — cascade-session.ts returns before
// calling this function at all (`if (options?.isReminderReaffirmation) return;`), so it is
// not observable from this module and is deliberately not asserted here.
