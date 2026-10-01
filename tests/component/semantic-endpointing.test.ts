import { describe, expect, it } from "vitest";
import {
  INCOMPLETE_PARTIAL_HANGOVER_MS,
  looksLikeIncompletePartial,
  resolveEndpointHangoverMs,
} from "@/lib/voice/turn-commit.shared";

describe("looksLikeIncompletePartial — holds the window open mid-thought", () => {
  it.each([
    ["my postcode is", "trailing copula"],
    ["it's about", "trailing preposition"],
    ["I live at", "trailing preposition"],
    ["yes and", "trailing conjunction"],
    ["we want to sell because", "trailing connective"],
    ["the property is my", "trailing possessive"],
    ["it's um", "hesitation"],
    ["my number is double", "dictation in progress"],
  ])("waits on %j (%s)", (text) => {
    expect(looksLikeIncompletePartial(text)).toBe(true);
  });

  it("waits on half a postcode", () => {
    // Outward code arrived, inward half has not.
    expect(looksLikeIncompletePartial("PR5")).toBe(true);
    expect(looksLikeIncompletePartial("it's PR5")).toBe(true);
  });

  it("stops waiting once the postcode is whole", () => {
    expect(looksLikeIncompletePartial("PR5 6XQ")).toBe(false);
  });

  it("waits on a stray short number, not on a full phone number", () => {
    expect(looksLikeIncompletePartial("079")).toBe(true);
    expect(looksLikeIncompletePartial("07902407048")).toBe(false);
  });

});

describe("looksLikeIncompletePartial — false positives are the dangerous direction", () => {
  it.each([
    "yes",
    "no",
    "yeah that's right",
    "not interested",
    "I own it outright",
    "about six months",
    "fourteen Bluebell Way",
    "it is a freehold house",
    "no thank you",
    "Mister",
  ])("treats %j as finished", (text) => {
    expect(looksLikeIncompletePartial(text)).toBe(false);
  });

  it("respects the caller's own terminal punctuation", () => {
    // "and" would normally hold, but the full stop says otherwise.
    expect(looksLikeIncompletePartial("me and my wife and.")).toBe(false);
    expect(looksLikeIncompletePartial("is it?")).toBe(false);
  });

  it("never holds back an answer the commit path already considers ready", () => {
    for (const ready of ["yes", "no", "PR5 6XQ", "07902407048"]) {
      expect(looksLikeIncompletePartial(ready)).toBe(false);
    }
  });

  it("is quiet on empty or whitespace input", () => {
    expect(looksLikeIncompletePartial("")).toBe(false);
    expect(looksLikeIncompletePartial("   ")).toBe(false);
  });
});

describe("resolveEndpointHangoverMs", () => {
  const base = 500;

  it("still shortens hard for a complete short reply", () => {
    expect(resolveEndpointHangoverMs("yes", base)).toBeLessThanOrEqual(250);
  });

  it("now extends for a partial that is clearly unfinished", () => {
    expect(resolveEndpointHangoverMs("my postcode is", base)).toBe(
      INCOMPLETE_PARTIAL_HANGOVER_MS,
    );
  });

  it("leaves an ordinary partial on the configured base", () => {
    expect(resolveEndpointHangoverMs("it is a freehold house", base)).toBe(base);
  });

  it("only ever extends, so a deliberately long base is respected", () => {
    expect(resolveEndpointHangoverMs("my postcode is", 1200)).toBe(1200);
  });

  it("falls back to base with no partial yet", () => {
    expect(resolveEndpointHangoverMs(undefined, base)).toBe(base);
    expect(resolveEndpointHangoverMs("", base)).toBe(base);
  });

  it("prefers the fast path when a partial is both short-complete and short", () => {
    // Ordering matters: commit-ready checks must win over the extend branch.
    expect(resolveEndpointHangoverMs("okay", base)).toBeLessThanOrEqual(250);
  });

  describe("street-only fragment, gated on the node actually asking for a full address", () => {
    const fullAddressPrompt =
      "Could you please confirm the full property address for me, including the street address, city, and postcode?";
    const streetOnlyPrompt = "What's your street name?";

    it("extends when the node explicitly wants street + city/postcode and the caller has only given a street", () => {
      expect(resolveEndpointHangoverMs("123 Main Street", base, fullAddressPrompt)).toBe(
        INCOMPLETE_PARTIAL_HANGOVER_MS,
      );
      expect(resolveEndpointHangoverMs("it's 45 Kingston Road", base, fullAddressPrompt)).toBe(
        INCOMPLETE_PARTIAL_HANGOVER_MS,
      );
    });

    it("does not extend once the city or postcode has followed the street", () => {
      expect(
        resolveEndpointHangoverMs("123 Main Street, Manchester", base, fullAddressPrompt),
      ).toBe(base);
      expect(resolveEndpointHangoverMs("45 Kingston Road PR5 6XQ", base, fullAddressPrompt)).toBe(
        base,
      );
    });

    it("leaves a street-only answer alone when the node only ever asked for the street name", () => {
      // The exact case that broke a blind version of this heuristic: "fourteen Bluebell Way" must
      // stay a complete answer when nothing about the question implies more is coming.
      expect(resolveEndpointHangoverMs("fourteen Bluebell Way", base, streetOnlyPrompt)).toBe(base);
      expect(resolveEndpointHangoverMs("123 Main Street", base)).toBe(base);
    });
  });
});

describe("looksLikeAskingForFullAddress", () => {
  it("recognises a node that explicitly wants a full address", async () => {
    const { looksLikeAskingForFullAddress } = await import("@/lib/voice/turn-commit.shared");
    expect(
      looksLikeAskingForFullAddress(
        "Could you please confirm the full property address for me, including the street address, city, and postcode?",
      ),
    ).toBe(true);
  });

  it("leaves a plain street-name question alone", async () => {
    const { looksLikeAskingForFullAddress } = await import("@/lib/voice/turn-commit.shared");
    expect(looksLikeAskingForFullAddress("What's your street name?")).toBe(false);
    expect(looksLikeAskingForFullAddress(undefined)).toBe(false);
  });
});
