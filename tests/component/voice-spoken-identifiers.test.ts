import { describe, expect, it } from "vitest";
import {
  collapseSpelledWords,
  normaliseSpokenAddressNumbers,
  normaliseSpokenEmails,
  normaliseSpokenIdentifiers,
  normaliseSpokenUkPostcodes,
} from "@/lib/voice/graph/spoken-identifiers.shared";

describe("normaliseSpokenEmails", () => {
  it.each([
    ["my email is joe at gmail dot com", "my email is joe@gmail.com"],
    ["It's jane dot smith at acme dot co dot uk.", "It's jane.smith@acme.co.uk."],
    ["j o e at g mail dot com", "joe@gmail.com"],
    ["j-o-e at gmail dot com", "joe@gmail.com"],
    ["john underscore doe one two three at outlook dot com", "john_doe123@outlook.com"],
    ["sam dash lee at yahoo dot com thanks", "sam-lee@yahoo.com thanks"],
    ["anna double l at gmail dot com", "annall@gmail.com"],
    ["bob at the rate of hotmail dot com", "bob@hotmail.com"],
    ["joe plus work at gmail dot com", "joe+work@gmail.com"],
    ["Sure, it's priya.shah at proton dot me, please", "Sure, it's priya.shah@proton.me, please"],
  ])("%s", (input, expected) => {
    expect(normaliseSpokenEmails(input)).toBe(expected);
  });

  it("leaves a typed email and ordinary sentences alone", () => {
    expect(normaliseSpokenEmails("it is joe@gmail.com")).toBe("it is joe@gmail.com");
    expect(normaliseSpokenEmails("I'll meet you at the station")).toBe("I'll meet you at the station");
    expect(normaliseSpokenEmails("look at my website dot com")).toBe("look at my website dot com");
    expect(normaliseSpokenEmails("call me at five")).toBe("call me at five");
  });

  it("handles two emails in one reply", () => {
    expect(normaliseSpokenEmails("joe at bt dot com or sue at b2 dot org")).toBe("joe@bt.com or sue@b2.org");
  });
});

describe("collapseSpelledWords", () => {
  it.each([
    ["my name is Siobhan, that's S I O B H A N", "my name is Siobhan, that's Siobhan"],
    ["S-I-O-B-H-A-N", "Siobhan"],
    ["it is l e e", "it is Lee"],
    ["T double L", "Tll"],
    ["B as in Bravo, O as in Oscar, B", "Bob"],
  ])("%s", (input, expected) => {
    expect(collapseSpelledWords(input)).toBe(expected);
  });

  it("does not touch ordinary sentences or short initials", () => {
    expect(collapseSpelledWords("I am a person")).toBe("I am a person");
    expect(collapseSpelledWords("J R Smith")).toBe("J R Smith");
  });
});

describe("normaliseSpokenUkPostcodes", () => {
  it.each([
    ["s w one a one a a", "SW1A 1AA"],
    ["it's e c one a one b b", "it's EC1A 1BB"],
    ["SW1A 1AA", "SW1A 1AA"],
    ["m one one a e", "M1 1AE"],
    ["b three three double o h", "b three three double o h"],
  ])("%s", (input, expected) => {
    expect(normaliseSpokenUkPostcodes(input)).toBe(expected);
  });

  it("leaves non-postcodes", () => {
    expect(normaliseSpokenUkPostcodes("I have a big house")).toBe("I have a big house");
  });
});

describe("normaliseSpokenAddressNumbers", () => {
  it.each([
    ["forty two baker street", "42 baker street"],
    ["I live at one four Acacia Avenue", "I live at 14 Acacia Avenue"],
    ["flat twelve, forty two Baker Street", "flat 12, 42 Baker Street"],
    ["one hundred and five high road", "105 high road"],
    ["number seven", "number 7"],
  ])("%s", (input, expected) => {
    expect(normaliseSpokenAddressNumbers(input)).toBe(expected);
  });

  it("does not rewrite numbers that are not part of an address", () => {
    expect(normaliseSpokenAddressNumbers("I have two kids")).toBe("I have two kids");
    expect(normaliseSpokenAddressNumbers("we are twelve people")).toBe("we are twelve people");
  });
});

describe("normaliseSpokenIdentifiers", () => {
  it("applies postcodes only when asked to", () => {
    const text = "flat twelve, forty two baker street s w one a one a a";
    expect(normaliseSpokenIdentifiers(text)).toBe("flat 12, 42 baker street s w one a one a a");
    expect(normaliseSpokenIdentifiers(text, { ukPostcodes: true })).toBe(
      "flat 12, 42 baker street SW1A 1AA",
    );
  });

  it("lets an email keep its own spelled letters and digits", () => {
    expect(normaliseSpokenIdentifiers("j o e one two at gmail dot com")).toBe("joe12@gmail.com");
  });

  it("returns empty / blank input unchanged", () => {
    expect(normaliseSpokenIdentifiers("")).toBe("");
    expect(normaliseSpokenIdentifiers("   ")).toBe("   ");
  });
});
