import { describe, expect, it } from "vitest";
import { interpolateStaticSpeech } from "@/lib/voice/graph/flow";
import { lookupRuntimeValue } from "@/lib/voice/graph/variables.shared";

describe("variable casing", () => {
  it("resolves {{first_name}} from a First_name the provider sent", () => {
    // Retell sends First_name; flows are written against first_name. The
    // mismatch used to produce an empty name with no error anywhere.
    expect(lookupRuntimeValue({ First_name: "Sarah" } as never, "first_name")).toBe("Sarah");
  });

  it("resolves {{First_name}} from a lowercase first_name too", () => {
    expect(lookupRuntimeValue({ first_name: "Sarah" } as never, "First_name")).toBe("Sarah");
  });

  it("prefers an exact match over a differently-cased one", () => {
    expect(
      lookupRuntimeValue({ first_name: "Exact", First_name: "Other" } as never, "first_name"),
    ).toBe("Exact");
  });

  it("still returns undefined when the variable genuinely is not there", () => {
    expect(lookupRuntimeValue({ last_name: "Mitchell" } as never, "first_name")).toBeUndefined();
  });

  it("carries through to spoken output", () => {
    expect(interpolateStaticSpeech("Hi {{first_name}}, how are you?", { First_name: "Sarah" })).toBe(
      "Hi Sarah, how are you?",
    );
  });
});

describe("punctuation left behind by a stripped variable", () => {
  it("does not leave a space before the comma", () => {
    // Was: "Hi , how are you?" — TTS reads that with an audible stumble.
    expect(interpolateStaticSpeech("Hi {{first_name}}, how are you?", {})).toBe(
      "Hi, how are you?",
    );
  });

  it("does not leave a space before a full stop", () => {
    expect(interpolateStaticSpeech("Speaking with {{first_name}}.", {})).toBe("Speaking with.");
  });

  it("drops a separator that ends up against a terminal mark", () => {
    expect(interpolateStaticSpeech("Thanks {{first_name}},.", {})).toBe("Thanks.");
  });

  it("collapses a doubled separator", () => {
    expect(interpolateStaticSpeech("Hi {{a}}, {{b}}, there.", {})).toBe("Hi, there.");
  });

  it("removes a leading separator when the variable opened the line", () => {
    expect(interpolateStaticSpeech("{{first_name}}, welcome back.", {})).toBe("welcome back.");
  });

  it("leaves a fully resolved sentence untouched", () => {
    expect(
      interpolateStaticSpeech("Hi {{first_name}}, your property at {{addr}} is listed.", {
        first_name: "Sarah",
        addr: "14 Bluebell Way",
      }),
    ).toBe("Hi Sarah, your property at 14 Bluebell Way is listed.");
  });

  it("never emits a raw placeholder", () => {
    for (const vars of [{}, { first_name: "Sarah" }]) {
      expect(interpolateStaticSpeech("Hi {{first_name}} at {{missing}}.", vars)).not.toContain("{{");
    }
  });
});
