import { describe, expect, it } from "vitest";
import {
  detectVoicemailGreeting,
  resolveVoicemailPolicy,
  VOICEMAIL_TIMEOUT_DEFAULT_MS,
} from "@/lib/voice/voicemail.shared";

describe("detectVoicemailGreeting", () => {
  it.each([
    "Hi, you've reached John. I'm not available right now. Please leave a message after the tone.",
    "The person you are trying to reach is not available. Please leave a message after the beep.",
    "Hello, you have reached the voicemail of Sarah Jones. Please leave your name and number.",
    "The number you have dialed is currently unavailable.",
    "Your call has been forwarded to an automatic voice message system. At the tone, please record your message.",
    "Sorry I missed your call, I'll get back to you as soon as I can.",
    "The subscriber you are calling is not reachable at the moment.",
  ])("flags a greeting: %s", (text) => {
    expect(detectVoicemailGreeting(text)).not.toBeNull();
  });

  it.each([
    "Hello?",
    "Yes speaking.",
    "Hi, who's this?",
    "Sorry, I can't talk right now, can you call me back later?",
    "I'm not available at the moment, my husband is though.",
    "Yeah I'll check my voicemail later",
    "Yes, this is a good time, go ahead.",
    "You have reached me, what is it about?",
    "Not interested, thanks.",
  ])("does not flag a person: %s", (text) => {
    expect(detectVoicemailGreeting(text)).toBeNull();
  });

  it("names the cues it matched", () => {
    expect(detectVoicemailGreeting("please leave a message after the tone")?.cues).toEqual(
      expect.arrayContaining(["leave a message", "after the tone"]),
    );
  });
});

describe("resolveVoicemailPolicy", () => {
  it("is off unless configured", () => {
    expect(resolveVoicemailPolicy(undefined)).toBeNull();
    expect(resolveVoicemailPolicy({})).toBeNull();
    expect(resolveVoicemailPolicy({ voicemailAction: "none" })).toBeNull();
  });

  it("reads the builder fields", () => {
    expect(resolveVoicemailPolicy({ voicemailAction: "hangup" })).toEqual({
      action: "hangup",
      message: "",
      timeoutMs: VOICEMAIL_TIMEOUT_DEFAULT_MS,
    });
    expect(
      resolveVoicemailPolicy({
        voicemailAction: "leave_message",
        voicemailMessage: " Hi, call us back. ",
        voicemailDetectionTimeoutMs: 1000,
      }),
    ).toEqual({ action: "leave_message", message: "Hi, call us back.", timeoutMs: 5000 });
  });

  it("ignores leave_message with no message", () => {
    expect(resolveVoicemailPolicy({ voicemailAction: "leave_message", voicemailMessage: "  " })).toBeNull();
  });

  it("falls back to an imported Retell voicemail_option", () => {
    expect(
      resolveVoicemailPolicy({
        rawAgent: { voicemail_option: { action: { type: "static_text", text: "Please call back" } }, voicemail_detection_timeout_ms: 20000 },
      }),
    ).toEqual({ action: "leave_message", message: "Please call back", timeoutMs: 20000 });
    expect(
      resolveVoicemailPolicy({ rawAgent: { voicemail_option: { action: { type: "hangup" } } } })?.action,
    ).toBe("hangup");
    expect(resolveVoicemailPolicy({ rawAgent: { voicemail_option: { action: { type: "prompt", text: "x" } } } })).toBeNull();
  });
});
