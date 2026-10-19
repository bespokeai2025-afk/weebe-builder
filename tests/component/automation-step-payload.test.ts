import { describe, expect, it } from "vitest";
import { capStepPayload } from "@/lib/automation-engine/persistence/step-payload.shared";

describe("capStepPayload", () => {
  it("keeps a small payload exactly as it is", () => {
    const small = { call_id: "c1", nested: { a: 1, b: [1, 2] } };
    expect(capStepPayload(small)).toBe(small);
  });

  it("keeps top-level scalars and describes nested values when the payload is large", () => {
    const big = {
      call_id: "c1",
      score: 7,
      summary: "x".repeat(1000),
      transcript_object: Array.from({ length: 400 }, (_, i) => ({ role: "user", content: `turn ${i} ${"y".repeat(40)}` })),
      lead: { name: "Jane", address: "42 Baker Street" },
    };
    const capped = capStepPayload(big);
    expect(capped.call_id).toBe("c1");
    expect(capped.score).toBe(7);
    expect(String(capped.summary).length).toBeLessThan(310);
    expect(capped.transcript_object).toBe("[array, 400 items]");
    expect(capped.lead).toBe("[object, 2 keys]");
    expect((capped._truncated as { original_bytes: number }).original_bytes).toBeGreaterThan(8192);
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(8192);
  });

  it("falls back to the key list when even the summary is too big", () => {
    const wide = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`field_${i}`, "z".repeat(200)]));
    const capped = capStepPayload(wide);
    expect(capped.keys).toHaveLength(100);
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(8192);
  });
});
