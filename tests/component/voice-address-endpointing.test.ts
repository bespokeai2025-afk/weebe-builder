import { describe, expect, it } from "vitest";

import {
  INCOMPLETE_PARTIAL_HANGOVER_MS,
  looksLikeIncompletePartial,
  resolveEndpointHangoverMs,
} from "@/lib/voice/turn-commit.shared";

// An answer said in beats ("12 High Street, Manchester," … "M1 1AA") is held by the recogniser's
// own punctuation — the engine assumes nothing about addresses or what a step asked for.
describe("an answer said in beats", () => {
  it("waits through a pause the recogniser marked with a comma", () => {
    expect(resolveEndpointHangoverMs("12 High Street, Manchester,", 560)).toBe(INCOMPLETE_PARTIAL_HANGOVER_MS);
  });

  it("does not wait once the recogniser closed the sentence", () => {
    expect(resolveEndpointHangoverMs("12 High Street, Manchester, M1 1AA.", 560)).toBe(560);
    expect(resolveEndpointHangoverMs("12 High Street, Manchester", 560)).toBe(560);
  });

  it("never holds back a short answer", () => {
    expect(looksLikeIncompletePartial("Yes,")).toBe(false);
    expect(looksLikeIncompletePartial("Manchester.")).toBe(false);
  });
});
