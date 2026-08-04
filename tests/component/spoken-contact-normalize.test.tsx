import { describe, it, expect } from "vitest";
import {
  normalizeSpokenEmail,
  normalizeSpokenPhone,
} from "@/lib/lead-gen/spoken-contact-normalize.shared";

describe("normalizeSpokenEmail", () => {
  it("converts a number-word suffix in the local part (real Aug 2026 case)", () => {
    const r = normalizeSpokenEmail("jomwaseightyseven@gmail.com");
    // "jomwas" + "eightyseven" → longest numeric suffix wins from earliest start:
    // scan finds "seightyseven"? no — 's' isn't a number word, so first parseable
    // suffix is "eightyseven" → 87.
    expect(r.email).toBe("jomwas87@gmail.com");
    expect(r.changed).toBe(true);
  });

  it("converts tens+unit and plain digit words", () => {
    expect(normalizeSpokenEmail("katetwentyone@yahoo.com").email).toBe("kate21@yahoo.com");
    expect(normalizeSpokenEmail("bobonetwothree@x.co").email).toBe("bob123@x.co");
    expect(normalizeSpokenEmail("samnineteen@x.co").email).toBe("sam19@x.co");
  });

  it("never rewrites names without a full number-word suffix", () => {
    expect(normalizeSpokenEmail("stone@x.co").email).toBe("stone@x.co");
    expect(normalizeSpokenEmail("capone@x.co").email).toBe("capone@x.co"); // single-digit suffix never converted
    expect(normalizeSpokenEmail("simone.rossi@x.co").email).toBe("simone.rossi@x.co"); // suffix isn't pure number words
    expect(normalizeSpokenEmail("john.smith@gmail.com").changed).toBe(false);
  });

  it("strips trailing sentence punctuation and handles spoken at/dot", () => {
    expect(normalizeSpokenEmail("jomwa87@gmail.com.").email).toBe("jomwa87@gmail.com");
    expect(normalizeSpokenEmail("jane doe at gmail dot com").email).toBe("janedoe@gmail.com");
  });

  it("never touches the domain", () => {
    expect(normalizeSpokenEmail("abc@seventy.com").email).toBe("abc@seventy.com");
  });

  it("handles null/empty", () => {
    expect(normalizeSpokenEmail(null).email).toBeNull();
    expect(normalizeSpokenEmail("").email).toBeNull();
  });
});

describe("normalizeSpokenPhone", () => {
  it("passes through digit-like values, stripping separators", () => {
    expect(normalizeSpokenPhone("+44 7939 566-891").phone).toBe("+447939566891");
    expect(normalizeSpokenPhone("001624014").phone).toBe("001624014");
  });

  it("converts fully spoken numbers", () => {
    expect(normalizeSpokenPhone("zero one six two four zero one four").phone).toBe("01624014");
    expect(normalizeSpokenPhone("oh seven nine three nine").phone).toBe("07939");
  });

  it("converts mixed digit/word chunks", () => {
    expect(normalizeSpokenPhone("01 six two four 014").phone).toBe("01624014");
  });

  it("bails out on non-number words instead of guessing", () => {
    const r = normalizeSpokenPhone("call me maybe");
    expect(r.phone).toBe("call me maybe");
    expect(r.changed).toBe(false);
  });
});
