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
});
