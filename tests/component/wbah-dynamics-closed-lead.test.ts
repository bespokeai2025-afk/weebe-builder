import { describe, expect, it } from "vitest";
import { isRecordAlreadyClosedError } from "@/lib/wbah/post-call/wbah-dynamics.server";

describe("isRecordAlreadyClosedError", () => {
  it("recognizes Dynamics' 'already closed' error code", () => {
    const body = JSON.stringify({
      error: { code: "0x80040519", message: "The lead is already closed." },
    });
    expect(isRecordAlreadyClosedError(body)).toBe(true);
  });

  it("recognizes the plain error message text even without the code", () => {
    expect(isRecordAlreadyClosedError("The opportunity is already closed.")).toBe(true);
  });

  it("does not match unrelated Dynamics errors", () => {
    const body = JSON.stringify({
      error: { code: "0x80048d19", message: "Cannot convert a value to target type 'Edm.Decimal'" },
    });
    expect(isRecordAlreadyClosedError(body)).toBe(false);
  });
});
