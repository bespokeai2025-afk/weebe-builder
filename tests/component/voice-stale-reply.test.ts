/**
 * "Yeah" said twice because the transcript was slow: the second one must not answer the next
 * node's question, which the caller had not heard yet.
 */
import { describe, expect, it } from "vitest";
import { isAckOrRepeat, isRepeatOf, isStaleReply } from "@/lib/voice/stale-reply.shared";

describe("stale caller replies", () => {
  // Timeline (ms): first "yeah" accepted at 10_000; agent replies (speak) at 11_200; its audio
  // starts playing at 11_700.
  const base = { lastAcceptedUserAt: 10_000, replySpeakAt: 11_200, replyAudioStartAt: 11_700 };

  it("treats a 'yeah' begun before the agent's reply was heard as stale", () => {
    expect(isStaleReply({ ...base, speechStartAt: 10_800 })).toBe(true); // said while agent was thinking
    expect(isStaleReply({ ...base, speechStartAt: 12_000 })).toBe(true); // within the reaction margin
  });

  it("accepts a reply begun after the caller heard the question", () => {
    expect(isStaleReply({ ...base, speechStartAt: 14_500 })).toBe(false);
  });

  it("treats anything said while the reply is chosen but not yet audible as stale", () => {
    expect(isStaleReply({ ...base, replyAudioStartAt: null, speechStartAt: 11_500 })).toBe(true);
  });

  it("never flags a turn when the agent did not reply, or before any caller turn", () => {
    expect(isStaleReply({ ...base, replySpeakAt: null, replyAudioStartAt: null, speechStartAt: 10_500 })).toBe(false);
    expect(isStaleReply({ ...base, lastAcceptedUserAt: 0, speechStartAt: 10_500 })).toBe(false);
  });

  it("only drops acknowledgements and repeats — content is still handled", () => {
    expect(isAckOrRepeat("Yeah.", "yeah", true)).toBe(true);
    expect(isAckOrRepeat("Yes, yes.", "it's a house", true)).toBe(true);
    expect(isAckOrRepeat("Okay", "no", true)).toBe(true);
    expect(isAckOrRepeat("It's a house.", "it's a house", true)).toBe(true); // exact repeat
    expect(isAckOrRepeat("Yeah, it's a flat actually", "yeah", true)).toBe(false);
    expect(isAckOrRepeat("No", "yeah", true)).toBe(false);
  });

  it("matches only exact repeats for other languages", () => {
    expect(isAckOrRepeat("sí", "no", false)).toBe(false);
    expect(isAckOrRepeat("Sí.", "sí", false)).toBe(true);
    expect(isRepeatOf("Yeah!", "yeah")).toBe(true);
  });
});
