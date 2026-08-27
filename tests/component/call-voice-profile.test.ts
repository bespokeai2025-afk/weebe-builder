import { describe, expect, it } from "vitest";
import { buildStartRequest } from "@/lib/voice/tts/fish.provider";
import {
  isFishReferenceVoiceId,
  lockCallVoiceProfile,
  resolveCallVoiceId,
  voiceIdDiffersFromProfile,
} from "@/lib/voice/call-voice-profile.shared";

describe("call-voice-profile", () => {
  it("buildStartRequest always sends reference_id and consistency flags", () => {
    const req = buildStartRequest({
      voiceId: "fish-clone-abc",
      sampleRate: 24000,
      temperature: 0.45,
    });
    expect(req.reference_id).toBe("fish-clone-abc");
    expect(req.condition_on_previous_chunks).toBe(true);
    expect(req.normalize).toBe(true);
    expect(req.top_p).toBe(0.5);
    expect(req.chunk_length).toBe(200);
    expect(req.min_chunk_length).toBe(40);
  });
  it("rejects Retell/ElevenLabs voice ids for Fish TTS", () => {
    expect(isFishReferenceVoiceId("11labs-Adrian")).toBe(false);
    expect(isFishReferenceVoiceId("abc123fishmodel")).toBe(true);
  });

  it("prefers agent webeeVoiceId over legacy 11labs voice_id", () => {
    expect(
      resolveCallVoiceId({
        settings: { webeeVoiceId: "fish-agent-voice", voice_id: "11labs-Adrian" },
      }),
    ).toBe("fish-agent-voice");
  });

  it("uses session voice when webeeVoiceId is unset", () => {
    expect(
      resolveCallVoiceId({
        sessionVoiceId: "fish-clone-abc",
        settings: { voice_id: "11labs-Adrian" },
      }),
    ).toBe("fish-clone-abc");
  });

  it("locks prosody once for the whole call", () => {
    const profile = lockCallVoiceProfile({
      settings: { webeeVoiceId: "fish-agent-voice", voiceEmotion: "happy", voiceTemperature: 1.5 },
      sampleRate: 24000,
    });
    expect(profile.voiceId).toBe("fish-agent-voice");
    expect(profile.temperature).toBeLessThanOrEqual(0.2);
    expect(profile.cloneVoice).toBe(false);
  });

  it("marks owned Fish clones so TTS can lock in-call timbre", () => {
    const profile = lockCallVoiceProfile({
      settings: { webeeVoiceId: "fish-clone-abc", webeeVoiceOwned: true },
      sampleRate: 24000,
    });
    expect(profile.cloneVoice).toBe(true);
    expect(profile.temperature).toBeLessThanOrEqual(0.1);
  });

  it("detects mid-call voice override attempts", () => {
    const profile = lockCallVoiceProfile({
      settings: { webeeVoiceId: "fish-a" },
      sampleRate: 24000,
    });
    expect(voiceIdDiffersFromProfile(profile, "fish-b")).toBe(true);
    expect(voiceIdDiffersFromProfile(profile, "11labs-Adrian")).toBe(false);
  });
});
