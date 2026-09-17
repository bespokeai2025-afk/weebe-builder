import { describe, expect, it } from "vitest";
import {
  isVerbatimSpeakable,
  looksLikeAgentInstructionProse,
  looksLikeSpokenLine,
  spokenFallback,
} from "@/lib/voice/graph/speech-prompt.shared";

// Verbatim from node_urgent_prep on call 4af0665a — this entire block was read
// down the phone when the speech model returned no tokens.
const REAL_PROMPT =
  "The caller needs to speak with clinic staff. This could be because of urgent " +
  "symptoms, frustration, a request for a human, or a situation you cannot handle. " +
  'Acknowledge their concern with empathy. Say something like: "I understand. Let me ' +
  'connect you with our clinic staff right away." If the caller describes a ' +
  "life-threatening emergency (chest pain, difficulty breathing, signs of stroke), " +
  "advise them to call 911 immediately.";

describe("agent instruction prose is never spoken", () => {
  it("recognises the block that was actually read aloud", () => {
    expect(looksLikeAgentInstructionProse(REAL_PROMPT)).toBe(true);
  });

  it("does not return it as a spoken fallback", () => {
    const out = spokenFallback({ script: REAL_PROMPT, directions: [], task: "" });
    expect(out).not.toContain("the caller");
    expect(out).not.toContain("Say something like");
    expect(out).not.toContain("911");
  });

  it("says something harmless instead of reading the prompt", () => {
    const out = spokenFallback({ script: REAL_PROMPT, directions: [], task: "" });
    expect(out.length).toBeLessThan(40);
  });

  it("refuses it as verbatim-speakable and as a spoken line", () => {
    expect(isVerbatimSpeakable(REAL_PROMPT)).toBe(false);
    expect(looksLikeSpokenLine(REAL_PROMPT)).toBe(false);
  });

  it.each([
    "The caller wants to reschedule.",
    "Acknowledge their concern and move on.",
    "Say something like: I can help with that.",
    "Your goal is to collect the postcode.",
    "Reassure them that the call is free.",
  ])("flags %j", (text) => {
    expect(looksLikeAgentInstructionProse(text)).toBe(true);
  });
});

describe("ordinary spoken lines are untouched", () => {
  it.each([
    "Hi, this is Clare calling from We Buy Any House.",
    "Thank you for calling Venus Hospital, how may I help you today?",
    "Could you confirm your postcode for me?",
    "If you would like, I can book that in for you now.",
    "I understand. Let me connect you with our clinic staff right away.",
    "No problem at all — what time suits you?",
  ])("does not flag %j", (text) => {
    expect(looksLikeAgentInstructionProse(text)).toBe(false);
  });

  it("still returns a genuine script as the fallback", () => {
    const line = "Thanks — what is your postcode?";
    expect(spokenFallback({ script: line, directions: [], task: "" })).toBe(line);
  });
});
