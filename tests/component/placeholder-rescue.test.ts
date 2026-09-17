import { describe, expect, it } from "vitest";
import { interpolateStaticSpeech } from "@/lib/voice/graph/flow";
import { resolveVariables } from "@/lib/voice/graph/variables.shared";

/**
 * On call 46fa46fe the LLM wrote its own line as
 *   "Thank you for confirming, {{first name}} {{last name}}."
 * with spaces instead of underscores. The strict placeholder pattern requires
 * [a-zA-Z_][a-zA-Z0-9_.]*, so that matched nothing — it was neither resolved
 * nor stripped, and Fish read the braces out loud to the caller.
 */
describe("LLM near-miss placeholders", () => {
  const vars = { first_name: "Sarah", last_name: "Mitchell" };

  it("resolves a space-separated name from the underscore variable", () => {
    expect(
      interpolateStaticSpeech("Thank you for confirming, {{first name}} {{last name}}.", vars),
    ).toBe("Thank you for confirming, Sarah Mitchell.");
  });

  it("resolves a hyphenated near-miss too", () => {
    expect(interpolateStaticSpeech("Hi {{first-name}}.", vars)).toBe("Hi Sarah.");
  });

  it("still resolves the correct spelling", () => {
    expect(interpolateStaticSpeech("Hi {{first_name}}.", vars)).toBe("Hi Sarah.");
  });

  it("never lets braces reach TTS, even for a name that does not exist", () => {
    const out = interpolateStaticSpeech("Your {{some unknown thing}} is ready.", vars);
    expect(out).not.toContain("{{");
    expect(out).not.toContain("}}");
  });

  it("strips a placeholder containing punctuation rather than speaking it", () => {
    const out = interpolateStaticSpeech("Ref {{booking #ref!}} confirmed.", vars);
    expect(out).not.toContain("{{");
  });

  it("leaves braces alone when not stripping (prompt authoring)", () => {
    // The builder shows the author their own text; silently deleting an unknown
    // token there would hide their typo.
    expect(resolveVariables("Hi {{first name}} and {{nope}}.", vars)).toContain("{{nope}}");
  });

  it("handles several near-misses in one line", () => {
    expect(
      interpolateStaticSpeech("{{first name}} {{last name}} — {{first name}} again.", vars),
    ).toBe("Sarah Mitchell — Sarah again.");
  });

  it("does not touch text that has no placeholders", () => {
    const plain = "Nothing to substitute here.";
    expect(interpolateStaticSpeech(plain, vars)).toBe(plain);
  });
});
