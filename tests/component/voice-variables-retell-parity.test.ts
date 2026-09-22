/**
 * Variables in the WEBEE Native builder behaving the way they do in Retell.
 *
 * Retell: a prompt containing {{first_name}} speaks the value when it is known and asks for it when
 * it is not. Here the speech path stripped the unresolved reference, so the model got a broken
 * fragment with no sign anything was missing. And extraction accepted any string for any string
 * field, so on a test call the caller's email was stored — and read back — as the mobile number.
 */
import { describe, expect, it } from "vitest";
import {
  humaniseVariableName,
  missingVariableNames,
  missingVariablesRule,
} from "../../src/lib/voice/graph/variables.shared";
import {
  inferFieldKind,
  validateExtractedValue,
} from "../../src/lib/voice/graph/extraction-validation.shared";

describe("missingVariableNames", () => {
  it("reports a referenced variable with no value", () => {
    expect(missingVariableNames("Confirm your email is {{email}}.", {})).toEqual(["email"]);
  });

  it("does not report one that is known", () => {
    expect(missingVariableNames("Hi {{first_name}}", { first_name: "Jane" })).toEqual([]);
  });

  it("treats an empty or whitespace value as missing, not known", () => {
    expect(missingVariableNames("Hi {{first_name}}", { first_name: "" })).toEqual(["first_name"]);
    expect(missingVariableNames("Hi {{first_name}}", { first_name: "   " })).toEqual([
      "first_name",
    ]);
  });

  it("separates the known from the unknown in one prompt", () => {
    expect(
      missingVariableNames("Hi {{first_name}}, is {{email}} right, and {{mobile_number}}?", {
        first_name: "Jane",
      }).sort(),
    ).toEqual(["email", "mobile_number"]);
  });

  it("honours the case-insensitive fallback the resolver already uses", () => {
    // Retell sends First_name where the flow says first_name.
    expect(missingVariableNames("Hi {{first_name}}", { First_name: "Jane" })).toEqual([]);
  });

  it("returns nothing for text without references", () => {
    expect(missingVariableNames("How can I help?", {})).toEqual([]);
    expect(missingVariableNames("", {})).toEqual([]);
  });
});

describe("missingVariablesRule", () => {
  it("is absent when nothing is missing, so a full call gets no extra instruction", () => {
    expect(missingVariablesRule([])).toBeNull();
  });

  it("tells the model to ask rather than state", () => {
    const rule = missingVariablesRule(["email"])!;
    expect(rule).toMatch(/ASK the caller/);
    expect(rule).toMatch(/Do not guess it, do not invent it/);
  });

  it("forbids putting one kind of information in place of another", () => {
    expect(missingVariablesRule(["mobile_number"])).toMatch(/an email is never a phone number/i);
  });

  it("forbids speaking placeholders or braces", () => {
    expect(missingVariablesRule(["first_name"])).toMatch(/Never say a placeholder/);
  });

  it("names each variable in plain words and by key", () => {
    const rule = missingVariablesRule(["mobile_number", "first_name"])!;
    expect(rule).toContain("mobile number ({{mobile_number}})");
    expect(rule).toContain("first name ({{first_name}})");
  });

  it("does not repeat a variable referenced twice", () => {
    expect(missingVariablesRule(["email", "email"])!.match(/\{\{email\}\}/g)).toHaveLength(1);
  });
});

describe("humaniseVariableName", () => {
  it("turns keys into words a caller would hear", () => {
    expect(humaniseVariableName("mobile_number")).toBe("mobile number");
    expect(humaniseVariableName("firstName")).toBe("first name");
    expect(humaniseVariableName("lead.email")).toBe("lead email");
  });
});

describe("inferFieldKind", () => {
  it("recognises the fields builders actually declare", () => {
    expect(inferFieldKind({ name: "email" })).toBe("email");
    expect(inferFieldKind({ name: "email_address" })).toBe("email");
    expect(inferFieldKind({ name: "mobile_number" })).toBe("phone");
    expect(inferFieldKind({ name: "phone" })).toBe("phone");
    expect(inferFieldKind({ name: "whatsapp" })).toBe("phone");
    expect(inferFieldKind({ name: "first_name" })).toBe("person_name");
    expect(inferFieldKind({ name: "postcode" })).toBe("postcode");
  });

  it("reads the description when the name is vague", () => {
    expect(inferFieldKind({ name: "contact", description: "the caller's mobile number" })).toBe(
      "phone",
    );
  });

  it("does not treat a company or property name as a person's name", () => {
    expect(inferFieldKind({ name: "company_name" })).toBe("generic");
    expect(inferFieldKind({ name: "property_name" })).toBe("generic");
  });
});

describe("validateExtractedValue — the test-call failure", () => {
  const mobile = { name: "mobile_number", type: "string" };
  const email = { name: "email", type: "string" };

  it("rejects an email placed in the mobile number field", () => {
    // Exactly what happened: the caller's email ended up as the mobile number.
    expect(validateExtractedValue(mobile, "jane@example.com")).toBeNull();
  });

  it("keeps a real mobile number, normalised to digits", () => {
    expect(validateExtractedValue(mobile, "07700 900 123")).toBe("07700900123");
    expect(validateExtractedValue(mobile, "+44 7700 900123")).toBe("+447700900123");
  });

  it("rejects words or too-short numbers in a phone field", () => {
    expect(validateExtractedValue(mobile, "I'll give it later")).toBeNull();
    expect(validateExtractedValue(mobile, "12345")).toBeNull();
  });

  it("accepts a real email and rebuilds one spoken aloud", () => {
    expect(validateExtractedValue(email, "jane@example.com")).toBe("jane@example.com");
    expect(validateExtractedValue(email, "jane at example dot com")).toBe("jane@example.com");
  });

  it("rejects a phone number placed in the email field", () => {
    expect(validateExtractedValue(email, "07700900123")).toBeNull();
  });

  it("rejects an email or a number in a person's name field", () => {
    const name = { name: "first_name", type: "string" };
    expect(validateExtractedValue(name, "jane@example.com")).toBeNull();
    expect(validateExtractedValue(name, "07700900123")).toBeNull();
    expect(validateExtractedValue(name, "Jane")).toBe("Jane");
  });

  it("enforces enum choices and returns the builder's own spelling", () => {
    const f = { name: "intent", type: "enum", choices: ["Sell", "Rent", "Keep"] };
    expect(validateExtractedValue(f, "rent")).toBe("Rent");
    expect(validateExtractedValue(f, "  SELL ")).toBe("Sell");
    expect(validateExtractedValue(f, "buy")).toBeNull();
  });

  it("leaves generic fields alone", () => {
    expect(validateExtractedValue({ name: "notes" }, "anything at all")).toBe("anything at all");
  });

  it("passes typed numbers and booleans through untouched", () => {
    expect(validateExtractedValue({ name: "bedrooms", type: "number" }, 3)).toBe(3);
    expect(validateExtractedValue({ name: "interested", type: "boolean" }, false)).toBe(false);
  });

  it("treats null and blank as not captured", () => {
    expect(validateExtractedValue(mobile, null)).toBeNull();
    expect(validateExtractedValue(mobile, "   ")).toBeNull();
  });
});

/**
 * Spoken phone numbers, converted deterministically before extraction.
 *
 * Left to the model this failed both ways on real phrasing: "double oh" dropped a zero, and after
 * worked examples were added to the prompt it started tripling digits instead. Every case below is
 * one that went wrong in live testing.
 */
import { normaliseSpokenNumbers } from "../../src/lib/voice/graph/extraction-validation.shared";

describe("normaliseSpokenNumbers", () => {
  it("keeps both zeros of 'double oh' — the digit the model used to drop", () => {
    expect(normaliseSpokenNumbers("oh seven seven double oh, nine hundred, one two three")).toBe(
      "07700900123",
    );
  });

  it("expands triple without over-counting — the model used to add a digit here", () => {
    expect(normaliseSpokenNumbers("zero seven nine one one, triple two, four five six")).toBe(
      "07911222456",
    );
  });

  it("keeps an international prefix", () => {
    expect(
      normaliseSpokenNumbers(
        "plus four four, seven seven double oh, nine double oh, one two three",
      ),
    ).toBe("+447700900123");
  });

  it("handles a UAE mobile read in groups", () => {
    expect(normaliseSpokenNumbers("oh five oh, double one, five four, six one two")).toBe(
      "0501154612",
    );
  });

  it("converts only the number, leaving the words around it", () => {
    expect(
      normaliseSpokenNumbers("Yes, it's oh seven seven double oh, nine hundred, one two three"),
    ).toBe("Yes, it's 07700900123");
  });

  it("leaves ordinary sentences with small numbers alone", () => {
    // Only runs of 6+ digits are rewritten.
    expect(normaliseSpokenNumbers("I want one bedroom and two bathrooms")).toBe(
      "I want one bedroom and two bathrooms",
    );
    expect(normaliseSpokenNumbers("two of them, maybe three")).toBe("two of them, maybe three");
  });

  it("leaves a spoken email alone, which has its own handling", () => {
    expect(normaliseSpokenNumbers("My email is jane at example dot com")).toBe(
      "My email is jane at example dot com",
    );
  });

  it("passes numerals through unchanged", () => {
    expect(normaliseSpokenNumbers("my number is 07700900123")).toBe("my number is 07700900123");
  });

  it("is safe on empty input", () => {
    expect(normaliseSpokenNumbers("")).toBe("");
  });
});
