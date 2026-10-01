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
    expect(req.min_chunk_length).toBe(12);
  });
  it("rejects Retell/ElevenLabs voice ids for Fish TTS", () => {
    expect(isFishReferenceVoiceId("11labs-Adrian")).toBe(false);
    expect(isFishReferenceVoiceId("custom_voice_d9442ca6d54f14b69b4f220acd")).toBe(false);
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

  describe("openai tts provider", () => {
    // Real bug: switching an agent to OpenAI TTS silently kept using the agent's Fish voice
    // hash as `voiceId` — OpenAI's provider falls back to a default voice rather than erroring
    // on an unrecognised one, so every call quietly ignored the OpenAI voice picked in the
    // builder (`settings.openaiVoice`) and always spoke in the same default voice instead.
    it("locks the agent's chosen OpenAI voice, not the Fish voice id", () => {
      const profile = lockCallVoiceProfile({
        settings: { webeeVoiceId: "164a9e442b984c3aa3fa8a21fd29a10c", openaiVoice: "nova" },
        sampleRate: 24000,
        ttsProvider: "openai",
      });
      expect(profile.voiceId).toBe("nova");
    });

    it("falls back to the default OpenAI voice rather than a Fish hash when none is set", () => {
      const profile = lockCallVoiceProfile({
        settings: { webeeVoiceId: "164a9e442b984c3aa3fa8a21fd29a10c" },
        sampleRate: 24000,
        ttsProvider: "openai",
      });
      expect(profile.voiceId).not.toBe("164a9e442b984c3aa3fa8a21fd29a10c");
      expect(profile.voiceId).toBeTruthy();
    });

    it("does not carry Fish-only prosody fields into an OpenAI profile", () => {
      const profile = lockCallVoiceProfile({
        settings: { openaiVoice: "alloy", webeeVoiceOwned: true },
        sampleRate: 24000,
        ttsProvider: "openai",
      });
      expect(profile.cloneVoice).toBeUndefined();
    });
  });
});
