/**
 * `maxCallDurationMs` and `endCallAfterSilenceMs` were stored from the moment the builder shipped
 * these fields but never read by the native engine anywhere — a stuck or abandoned call had no
 * hard stop. These pin the one part with real room for a bug: parsing the untrusted settings blob
 * into "arm the timer" or "don't".
 */
import { describe, expect, it } from "vitest";
import {
  resolveEndCallAfterSilenceMs,
  resolveMaxCallDurationMs,
} from "@/lib/voice/lifecycle/call-safety-limits.shared";

describe("resolveMaxCallDurationMs", () => {
  it("returns the configured value when it's a positive number", () => {
    expect(resolveMaxCallDurationMs({ maxCallDurationMs: 600_000 })).toBe(600_000);
  });

  it("returns null when unset", () => {
    expect(resolveMaxCallDurationMs({})).toBeNull();
    expect(resolveMaxCallDurationMs(null)).toBeNull();
    expect(resolveMaxCallDurationMs(undefined)).toBeNull();
  });

  it("returns null for zero or negative — never arms a timer that would fire instantly", () => {
    expect(resolveMaxCallDurationMs({ maxCallDurationMs: 0 })).toBeNull();
    expect(resolveMaxCallDurationMs({ maxCallDurationMs: -1000 })).toBeNull();
  });

  it("returns null for a non-numeric value rather than coercing something unexpected", () => {
    expect(resolveMaxCallDurationMs({ maxCallDurationMs: "not a number" })).toBeNull();
    expect(resolveMaxCallDurationMs({ maxCallDurationMs: NaN })).toBeNull();
    expect(resolveMaxCallDurationMs({ maxCallDurationMs: null })).toBeNull();
  });
});

describe("resolveEndCallAfterSilenceMs", () => {
  it("returns the configured value when it's a positive number", () => {
    expect(resolveEndCallAfterSilenceMs({ endCallAfterSilenceMs: 30_000 })).toBe(30_000);
  });

  it("returns null when unset, zero, negative, or non-numeric", () => {
    expect(resolveEndCallAfterSilenceMs({})).toBeNull();
    expect(resolveEndCallAfterSilenceMs({ endCallAfterSilenceMs: 0 })).toBeNull();
    expect(resolveEndCallAfterSilenceMs({ endCallAfterSilenceMs: -1 })).toBeNull();
    expect(resolveEndCallAfterSilenceMs({ endCallAfterSilenceMs: "soon" })).toBeNull();
  });

  it("is independent of maxCallDurationMs — the two limits don't leak into each other", () => {
    const settings = { maxCallDurationMs: 600_000, endCallAfterSilenceMs: 30_000 };
    expect(resolveMaxCallDurationMs(settings)).toBe(600_000);
    expect(resolveEndCallAfterSilenceMs(settings)).toBe(30_000);
  });
});
