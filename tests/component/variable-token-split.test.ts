import { describe, expect, it } from "vitest";

// Mirrors the constants in VariableHighlightOverlay. The stateful-regex trap
// these guard against is subtle enough to be worth pinning down in a test.
const TOKEN = /(\{\{\s*[a-zA-Z_][a-zA-Z0-9_.]*\s*\}\})/g;
const IS_TOKEN = /^\{\{\s*[a-zA-Z_][a-zA-Z0-9_.]*\s*\}\}$/;

function classify(value: string) {
  return value.split(TOKEN).map((part) => ({ part, token: IS_TOKEN.test(part) }));
}

describe("variable token highlighting", () => {
  it("splits a sentence into text and token parts", () => {
    const out = classify("Hi {{customer_name}}, about {{property_address}}.");
    expect(out.filter((p) => p.token).map((p) => p.part)).toEqual([
      "{{customer_name}}",
      "{{property_address}}",
    ]);
  });

  it("classifies every token, not every other one", () => {
    // A /g regex reused with .test() advances lastIndex between calls, so the
    // second and fourth tokens would come back false. This is the regression.
    const out = classify("{{a}} x {{b}} y {{c}} z {{d}}");
    expect(out.filter((p) => p.token).map((p) => p.part)).toEqual([
      "{{a}}",
      "{{b}}",
      "{{c}}",
      "{{d}}",
    ]);
  });

  it("leaves plain text untouched", () => {
    const out = classify("No variables here at all.");
    expect(out).toHaveLength(1);
    expect(out[0]!.token).toBe(false);
  });

  it("does not treat malformed braces as tokens", () => {
    for (const bad of ["{{ }}", "{{1bad}}", "{{un-closed", "{single}"]) {
      expect(classify(bad).some((p) => p.token)).toBe(false);
    }
  });

  it("handles dotted paths and internal spacing", () => {
    expect(classify("{{customer.name}}").some((p) => p.token)).toBe(true);
    expect(classify("{{ customer.name }}").some((p) => p.token)).toBe(true);
  });

  it("reassembles to exactly the original text", () => {
    const original = "Hi {{a}}, your slot is {{b.c}} — ok?";
    expect(classify(original).map((p) => p.part).join("")).toBe(original);
  });
});
