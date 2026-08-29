import { describe, expect, it } from "vitest";
import {
  constrainGeneratedSpeech,
  personaFromGlobalPrompt,
  speechOnNodeTask,
} from "@/lib/voice/graph/speech-isolate.shared";

describe("speech isolate", () => {
  it("keeps only a short identity slice of the global prompt", () => {
    const persona = personaFromGlobalPrompt(
      "Sound like Clare. We Buy Any House. Always collect the full property address and postcode before you book a slot.",
    );
    expect(persona).toContain("Sound like Clare");
    expect(persona).not.toContain("postcode");
  });

  it("rejects a sell-address question on a rebooking node", () => {
    expect(
      speechOnNodeTask(
        "Could you please confirm the address of the property you’re looking to sell?",
        "Ask if they want to rebook their consultation.",
        "Check Rebooking Interest",
      ),
    ).toBe(false);
  });

  it("keeps a paraphrase of the current node", () => {
    expect(
      speechOnNodeTask(
        "Would you like to rebook your consultation?",
        "Ask if they want to rebook their consultation.",
        "Check Rebooking Interest",
      ),
    ).toBe(true);
  });

  it("replaces off-topic speech with the node fallback", () => {
    const out = constrainGeneratedSpeech(
      "Could you confirm the property address you want to sell?",
      "Would you like to rebook your consultation?",
      "Ask if they want to rebook their consultation.",
      "Check Rebooking Interest",
    );
    expect(out.offTopic).toBe(true);
    expect(out.text).toBe("Would you like to rebook your consultation?");
  });
});
