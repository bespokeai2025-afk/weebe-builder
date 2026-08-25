import { describe, expect, it } from "vitest";

import {
  formatFishVoiceLabel,
  formatFishVoiceSubtitle,
  fishVoiceGroup,
} from "@/lib/voice/fish-voice-label.shared";
import { mergeFishVoiceLists } from "@/lib/voice/fish-voices.functions";

describe("formatFishVoiceLabel", () => {
  it("keeps owned voice titles as-is", () => {
    expect(
      formatFishVoiceLabel({
        title: "My Sales Agent",
        languages: ["en"],
        tags: ["male"],
        owned: true,
      }),
    ).toBe("My Sales Agent");
  });

  it("prefers a descriptive tag over noisy library titles", () => {
    expect(
      formatFishVoiceLabel({
        title: "Super Smash Bros. 4/Ultimate Announcer",
        languages: ["en"],
        tags: ["narration", "male"],
        owned: false,
      }),
    ).toBe("Super Smash Bros. 4/Ultimate Announcer");
  });
});

describe("formatFishVoiceSubtitle", () => {
  it("shows clone badge, tags, and languages", () => {
    expect(
      formatFishVoiceSubtitle({
        languages: ["en-US", "en-GB"],
        tags: ["male", "british"],
        owned: true,
      }),
    ).toContain("Your clone");
  });

  it("falls back to voice library when no metadata", () => {
    expect(
      formatFishVoiceSubtitle({
        languages: [],
        tags: [],
        owned: false,
      }),
    ).toBe("Voice library");
  });
});

describe("fishVoiceGroup", () => {
  it("separates owned and library voices", () => {
    expect(fishVoiceGroup({ owned: true })).toBe("yours");
    expect(fishVoiceGroup({ owned: false })).toBe("library");
  });
});

describe("mergeFishVoiceLists", () => {
  it("dedupes by voiceId and keeps owned first", () => {
    const owned = [
      {
        voiceId: "a",
        title: "Mine",
        languages: ["en"],
        tags: [],
        description: null,
        owned: true,
      },
    ];
    const library = [
      {
        voiceId: "a",
        title: "Dup",
        languages: ["en"],
        tags: [],
        description: null,
        owned: false,
      },
      {
        voiceId: "b",
        title: "Lib",
        languages: ["en"],
        tags: [],
        description: null,
        owned: false,
      },
    ];
    const merged = mergeFishVoiceLists(owned, library);
    expect(merged.map((v) => v.voiceId)).toEqual(["a", "b"]);
    expect(merged[0].owned).toBe(true);
  });
});
