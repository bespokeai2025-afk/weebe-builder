/**
 * Regression: replies landing on a duplicate lead instead of the imported one.
 *
 * Avenue Elite's CSV imports store UAE mobiles in national form ("561169769", 9 digits). WATI
 * delivers the reply from "971561169769". The exact comparison failed, and `phoneTail` requires 10+
 * digits so it returned null and matched nothing — `findLeadByPhone` gave up and the reply created
 * a NEW lead. The imported lead, the one actually in the campaign with the property data, was left
 * looking like it had never replied.
 */
import { describe, expect, it } from "vitest";
import {
  phoneMatchKey,
  phoneTail,
  normalizeWhatsAppPhone,
} from "@/lib/whatsapp/wati-campaign.server";

describe("phoneTail (unchanged — the strict key)", () => {
  it("still returns null below 10 digits, which is why lead matching needed its own key", () => {
    expect(phoneTail("561169769")).toBeNull();
    expect(phoneTail("971561169769")).toBe("1561169769");
  });
});

describe("phoneMatchKey", () => {
  it("gives a national-format UAE mobile the same key as its international form", () => {
    expect(phoneMatchKey("561169769")).toBe(phoneMatchKey("971561169769"));
    expect(phoneMatchKey("+971 56 116 9769")).toBe("561169769");
  });

  it("ignores a retained trunk zero, which the same import produced both ways", () => {
    // "0501004005" and "501004005" are one person stored twice.
    expect(phoneMatchKey("0501004005")).toBe(phoneMatchKey("501004005"));
    expect(phoneMatchKey("9710504540399")).toBe(phoneMatchKey("971504540399"));
  });

  it("matches across the country-code variants seen in the data", () => {
    expect(phoneMatchKey("330616874703")).toBe(phoneMatchKey("33616874703"));
  });

  it("does not collapse two genuinely different numbers", () => {
    expect(phoneMatchKey("971561169769")).not.toBe(phoneMatchKey("971561169760"));
    expect(phoneMatchKey("971500000001")).not.toBe(phoneMatchKey("971500000002"));
  });

  it("refuses to key something too short to identify anyone", () => {
    expect(phoneMatchKey("1234567")).toBeNull();
    expect(phoneMatchKey("")).toBeNull();
    expect(phoneMatchKey(null)).toBeNull();
    expect(phoneMatchKey(undefined)).toBeNull();
  });

  it("ignores formatting entirely", () => {
    expect(phoneMatchKey("+971 (56) 116-9769")).toBe(phoneMatchKey("971561169769"));
  });

  it("agrees with the normaliser the send path already uses", () => {
    const normalised = normalizeWhatsAppPhone("+971 56 116 9769");
    expect(phoneMatchKey(normalised)).toBe(phoneMatchKey("561169769"));
  });
});
