/**
 * Two more agent-level toggles stored from the start and read by nobody on a native call:
 * `reminderTriggerMs`/`reminderMaxCount` (a proactive "are you still there?" nudge) and
 * `allowUserDtmf`/`allowDtmfInterruption` (whether keypad input works at all, and whether it can
 * cut the agent off mid-sentence). A caller could always press digits and always interrupt with
 * them, and a silent caller got no nudge no matter how reminders were configured.
 */
import { describe, expect, it } from "vitest";
import { resolveReminderSettings } from "@/lib/voice/lifecycle/reminder-settings.shared";
import { shouldAcceptDtmf } from "@/lib/voice/lifecycle/dtmf-policy.shared";

describe("resolveReminderSettings", () => {
  it("returns both fields when configured", () => {
    expect(resolveReminderSettings({ reminderTriggerMs: 10_000, reminderMaxCount: 2 })).toEqual({
      triggerMs: 10_000,
      maxCount: 2,
    });
  });

  it("returns null when either field is missing — a nudge with no count (or vice versa) isn't configured", () => {
    expect(resolveReminderSettings({ reminderTriggerMs: 10_000 })).toBeNull();
    expect(resolveReminderSettings({ reminderMaxCount: 2 })).toBeNull();
    expect(resolveReminderSettings({})).toBeNull();
    expect(resolveReminderSettings(null)).toBeNull();
  });

  it("returns null for zero, negative, or non-numeric values", () => {
    expect(resolveReminderSettings({ reminderTriggerMs: 0, reminderMaxCount: 2 })).toBeNull();
    expect(resolveReminderSettings({ reminderTriggerMs: -5, reminderMaxCount: 2 })).toBeNull();
    expect(resolveReminderSettings({ reminderTriggerMs: 10_000, reminderMaxCount: 0 })).toBeNull();
    expect(resolveReminderSettings({ reminderTriggerMs: "soon", reminderMaxCount: 2 })).toBeNull();
  });
});

describe("shouldAcceptDtmf", () => {
  it("accepts digits by default when neither toggle is set — unset must not silently remove a capability", () => {
    expect(shouldAcceptDtmf({}, false)).toBe(true);
    expect(shouldAcceptDtmf({}, true)).toBe(true);
    expect(shouldAcceptDtmf(null, false)).toBe(true);
  });

  it("rejects every digit when allowUserDtmf is explicitly false, regardless of agent speech state", () => {
    expect(shouldAcceptDtmf({ allowUserDtmf: false }, false)).toBe(false);
    expect(shouldAcceptDtmf({ allowUserDtmf: false }, true)).toBe(false);
  });

  it("rejects a digit pressed while the agent is speaking when allowDtmfInterruption is false", () => {
    expect(shouldAcceptDtmf({ allowDtmfInterruption: false }, true)).toBe(false);
  });

  it("still accepts a digit pressed while the agent is quiet, even with allowDtmfInterruption false", () => {
    expect(shouldAcceptDtmf({ allowDtmfInterruption: false }, false)).toBe(true);
  });

  it("allowUserDtmf: false wins even if allowDtmfInterruption would otherwise allow it", () => {
    expect(shouldAcceptDtmf({ allowUserDtmf: false, allowDtmfInterruption: true }, false)).toBe(false);
  });
});
