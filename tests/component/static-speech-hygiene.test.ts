import { describe, expect, it } from "vitest";
import { interpolateStaticSpeech } from "@/lib/voice/graph/flow";

/**
 * The real WBAH contact-address node, verbatim from the builder. Authors mix
 * builder directions into the static text box; before this hygiene pass the
 * agent read them aloud to the caller.
 */
const WBAH_NODE = [
  "could I just confirm the contact address details are the same as your property address? if it is don't read it back to client!",
  "I have your contact address as {{contact_address}} {{postcode_contact}}",
  "if variables are not detected please ask for them. post code read back phonetic alphabet. is that correct?",
].join("\n");

describe("static speech — builder directions never reach the caller", () => {
  it("drops the 'don't read it back to client' direction", () => {
    const spoken = interpolateStaticSpeech(WBAH_NODE, {
      contact_address: "3 Elm Street",
      postcode_contact: "NG10 1BS",
    });
    expect(spoken).not.toMatch(/don't read it back/i);
    expect(spoken).not.toMatch(/if variables are not detected/i);
    expect(spoken).not.toMatch(/read back phonetic/i);
  });

  it("still speaks the real sentence, with variables filled in", () => {
    const spoken = interpolateStaticSpeech(WBAH_NODE, {
      contact_address: "3 Elm Street",
      postcode_contact: "NG10 1BS",
    });
    expect(spoken).toContain("3 Elm Street");
    expect(spoken).toContain("NG10 1BS");
  });

  it("does not leave a dangling 'as' fragment when the variables are unset", () => {
    const spoken = interpolateStaticSpeech(WBAH_NODE, {});
    // Previously spoke: "I have your contact address as" — then stopped dead.
    expect(spoken).not.toMatch(/contact address as\s*$/i);
    expect(spoken).not.toMatch(/\bas\s*$/i);
  });

  it("never emits a raw {{variable}} token to TTS", () => {
    const spoken = interpolateStaticSpeech(WBAH_NODE, {});
    expect(spoken).not.toContain("{{");
  });
});

describe("static speech — safety valve", () => {
  it("still speaks a one-line sentence that happens to start with a direction word", () => {
    // "Always"/"Only"/"Keep" prefixes are treated as builder directions, but a
    // static node consisting solely of that line must still say something
    // rather than fall silent.
    expect(interpolateStaticSpeech("Always happy to help!", {})).toBe("Always happy to help!");
    expect(interpolateStaticSpeech("Only takes a moment.", {})).toBe("Only takes a moment.");
  });

  it("speaks ordinary static sentences untouched", () => {
    expect(interpolateStaticSpeech("Goodbye!", {})).toBe("Goodbye!");
    expect(interpolateStaticSpeech("Your code is {{code}}", { code: "4821" })).toBe(
      "Your code is 4821",
    );
  });

  it("keeps a declared task-looking sentence verbatim (mode is declared, not guessed)", () => {
    expect(interpolateStaticSpeech("Ask the preferred title", {})).toBe("Ask the preferred title");
  });
});
