import { describe, expect, it } from "vitest";
import {
  parseWbahCallingLimit,
  parseWbahCallingLimitInput,
} from "@/lib/integrations/webespokeEnterprise/wbah-campaign-sync.types";

describe("parseWbahCallingLimit", () => {
  it("reads the backend envelope for each limit", () => {
    expect(
      parseWbahCallingLimit(
        { result: true, statuscode: 200, message: "ok", data: { maxConsecutiveVoicemails: 4, source: "env", envDefault: 4 } },
        "voicemail",
      ),
    ).toEqual({ value: 4, source: "env", envDefault: 4 });
    expect(
      parseWbahCallingLimit(
        { result: true, statuscode: 200, message: "ok", data: { maxDailyCallAttempts: 3, source: "redis", envDefault: 5 } },
        "daily",
      ),
    ).toEqual({ value: 3, source: "redis", envDefault: 5 });
  });

  it("rejects a response missing the setting", () => {
    expect(parseWbahCallingLimit({ data: { maxDailyCallAttempts: 3 } }, "voicemail")).toBeNull();
  });
});

describe("parseWbahCallingLimitInput", () => {
  it("accepts whole numbers from 1 to 30", () => {
    expect(parseWbahCallingLimitInput("1")).toBe(1);
    expect(parseWbahCallingLimitInput(" 12 ")).toBe(12);
    expect(parseWbahCallingLimitInput("30")).toBe(30);
  });

  it("rejects empty, zero, negative, decimal, non-numeric and over-cap input", () => {
    for (const bad of ["", "0", "-2", "2.5", "abc", "31", "1e2"]) {
      expect(parseWbahCallingLimitInput(bad), bad).toBeNull();
    }
  });
});
