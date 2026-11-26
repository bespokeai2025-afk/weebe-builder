import { describe, expect, it } from "vitest";
import {
  accentFromText,
  genderFromTags,
  openAiLibraryVoices,
  storedVoiceId,
  VOICE_PROVIDERS,
  voiceSelectionPatch,
} from "@/lib/voice/voice-library.shared";
import { lockCallVoiceProfile } from "@/lib/voice/call-voice-profile.shared";
import { settingSupport } from "@/lib/builder/engine-capabilities";
import type { BuilderSettings } from "@/lib/builder/types";

describe("voice library helpers", () => {
  it("reads gender from free-form tags", () => {
    expect(genderFromTags(["British", "Female", "calm"])).toBe("female");
    expect(genderFromTags(["man", "narration"])).toBe("male");
    expect(genderFromTags(["narration", "Males choir"])).toBeUndefined();
  });

  it("reads an accent from tags or a locale", () => {
    expect(accentFromText(["warm", "British"])).toBe("british");
    expect(accentFromText(["en-AU"])).toBe("australian");
    expect(accentFromText(["en_GB"])).toBe("british");
    expect(accentFromText(["deep voice"])).toBeUndefined();
  });

  it("stores each provider's voice in its own field and makes it the agent's TTS", () => {
    expect(voiceSelectionPatch("fish", { id: "abc", name: "Sarah", owned: true })).toEqual({
      webeeTtsProvider: "fish",
      webeeVoiceId: "abc",
      webeeVoiceName: "Sarah",
      webeeVoiceOwned: true,
    });
    expect(voiceSelectionPatch("cartesia", { id: "uuid", name: "Brooke", owned: false })).toEqual({
      webeeTtsProvider: "cartesia",
      cartesiaVoice: "uuid",
      cartesiaVoiceName: "Brooke",
    });
    expect(voiceSelectionPatch("openai", { id: "nova", name: "Nova", owned: false })).toEqual({
      webeeTtsProvider: "openai",
      openaiVoice: "nova",
    });
    expect(storedVoiceId({ cartesiaVoice: " uuid " }, "cartesia")).toBe("uuid");
    expect(storedVoiceId({}, "fish")).toBe("");
  });

  it("lists OpenAI's built-in voices and searches them by name", () => {
    expect(openAiLibraryVoices().length).toBeGreaterThan(5);
    expect(openAiLibraryVoices("nov")).toEqual([
      { id: "nova", name: "Nova", tags: [], owned: false },
    ]);
  });

  it("offers cloning only where the provider can clone", () => {
    expect(VOICE_PROVIDERS.fish.clone).toBe(true);
    expect(VOICE_PROVIDERS.cartesia.clone).toBe(true);
    expect(VOICE_PROVIDERS.openai.clone).toBe(false);
  });
});

describe("voice settings each provider applies", () => {
  it("passes the agent's speed to OpenAI voices, clamped to the builder's range", () => {
    const base = { sampleRate: 24000, ttsProvider: "openai" as const };
    expect(
      lockCallVoiceProfile({ ...base, settings: { openaiVoice: "nova", voiceSpeed: 1.25 } }).speed,
    ).toBe(1.25);
    expect(lockCallVoiceProfile({ ...base, settings: { voiceSpeed: 9 } }).speed).toBe(2);
    expect(lockCallVoiceProfile({ ...base, settings: {} }).speed).toBeUndefined();
  });

  it("tells the builder which voice settings Cartesia and OpenAI ignore", () => {
    const native = (tts: string) =>
      ({ deploymentMode: "WEBEE_NATIVE", webeeTtsProvider: tts }) as unknown as BuilderSettings;
    expect(settingSupport("voiceSpeed", native("cartesia")).support).toBe("none");
    expect(settingSupport("voiceSpeed", native("openai")).support).toBe("full");
    expect(settingSupport("volume", native("openai")).support).toBe("none");
    expect(settingSupport("volume", native("fish")).support).toBe("full");
  });

  it("keeps the picker's tuning list in step with those rules", () => {
    for (const [provider, caps] of Object.entries(VOICE_PROVIDERS)) {
      const s = {
        deploymentMode: "WEBEE_NATIVE",
        webeeTtsProvider: provider,
      } as unknown as BuilderSettings;
      for (const key of caps.tuning) {
        expect(
          settingSupport(key as keyof BuilderSettings, s).support,
          `${provider} ${key}`,
        ).not.toBe("none");
      }
    }
  });
});
