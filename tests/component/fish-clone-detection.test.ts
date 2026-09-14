import { describe, expect, it } from "vitest";
import { isOwnedFishCloneVoice, resolveFishTtsVoiceRequest } from "@/lib/voice/fish-tts-prosody.shared";

/**
 * A cloned Fish voice must be recognized as one, or it loses the in-call audio
 * anchor and its timbre re-samples on every new Fish WebSocket — which the
 * caller hears as the voice changing mid-call.
 *
 * Real case: three agents shared voice 164a9e44… ("Clare"), but only the one
 * carrying `webeeVoiceOwned: true` was detected as a clone. The others kept
 * the same voice and silently lost drift protection.
 */
describe("isOwnedFishCloneVoice", () => {
  it("detects an explicitly flagged clone", () => {
    expect(isOwnedFishCloneVoice({ webeeVoiceOwned: true })).toBe(true);
  });

  it("detects a renamed clone from its legacy custom_voice_* id", () => {
    // The exact shape of the agent that drifted: owned flag missing, name is a
    // real name rather than "Your clone", but the legacy id marks it a clone.
    expect(
      isOwnedFishCloneVoice({
        webeeVoiceId: "164a9e442b984c3aa3fa8a21fd29a10c",
        webeeVoiceName: "Clare",
        voiceId: "custom_voice_d9442ca6d54f14b69b4f220acd",
      }),
    ).toBe(true);
  });

  it("still detects the default-named clone", () => {
    expect(isOwnedFishCloneVoice({ webeeVoiceName: "Your clone" })).toBe(true);
  });

  it("does not misreport a stock library voice as a clone", () => {
    expect(isOwnedFishCloneVoice({ webeeVoiceId: "abc123", webeeVoiceName: "Library Voice" })).toBe(
      false,
    );
    expect(isOwnedFishCloneVoice(null)).toBe(false);
  });

  it("gives a detected clone the tighter temperature clamp", () => {
    const settings = {
      webeeVoiceId: "164a9e442b984c3aa3fa8a21fd29a10c",
      webeeVoiceName: "Clare",
      voiceId: "custom_voice_d9442ca6d54f14b69b4f220acd",
      voiceTemperature: 0.34,
    };
    const req = resolveFishTtsVoiceRequest({
      voiceId: "164a9e442b984c3aa3fa8a21fd29a10c",
      sampleRate: 8000,
      settings,
    });
    expect(req.cloneVoice).toBe(true);
    // Clones clamp to 0.1; library voices to 0.2. Lower = less timbre drift.
    expect(req.temperature).toBeLessThanOrEqual(0.1);
  });
});
