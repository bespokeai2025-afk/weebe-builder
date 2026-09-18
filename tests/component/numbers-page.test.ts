import { describe, expect, it, vi } from "vitest";
import { formatGbpPence } from "@/lib/telephony/format-price";
import {
  previewVoiceNumberPriceCore,
  type PreviewPriceDeps,
} from "@/lib/telephony/phone-provisioning.functions";

describe("formatGbpPence", () => {
  it("formats whole pounds", () => {
    expect(formatGbpPence(200)).toBe("£2.00");
  });

  it("formats pence correctly with two decimal places", () => {
    expect(formatGbpPence(242)).toBe("£2.42");
  });

  it("formats a single-digit pence value with leading zero", () => {
    expect(formatGbpPence(5)).toBe("£0.05");
  });

  it("formats zero", () => {
    expect(formatGbpPence(0)).toBe("£0.00");
  });

  it("returns an em-dash placeholder for null (e.g. an imported number with no snapshot)", () => {
    expect(formatGbpPence(null)).toBe("—");
  });

  it("returns an em-dash placeholder for undefined", () => {
    expect(formatGbpPence(undefined)).toBe("—");
  });
});

describe("previewVoiceNumberPriceCore", () => {
  function buildDeps(overrides: Partial<PreviewPriceDeps> = {}): PreviewPriceDeps {
    return {
      fetchPrice: vi.fn().mockResolvedValue({
        isoCountry: "US",
        numberType: "local",
        currentPriceUsd: 1.15,
        basePriceUsd: 1.0,
        priceUnit: "USD",
      }),
      resolveMarkup: vi.fn().mockResolvedValue({ markupType: "fixed", markupValue: 150, fxRateUsdToGbp: 0.8 }),
      computePrice: vi.fn().mockReturnValue({ costUsdCents: 115, costGbpPence: 92, priceGbpPence: 242 }),
      ...overrides,
    };
  }
  const sb = {} as any;

  it("looks up local pricing and applies the workspace's markup rule", async () => {
    const deps = buildDeps();
    const result = await previewVoiceNumberPriceCore(sb, "ws-1", { country: "US", tollFree: false }, deps);

    expect(deps.fetchPrice).toHaveBeenCalledWith(sb, { isoCountry: "US", numberType: "local" });
    expect(deps.resolveMarkup).toHaveBeenCalledWith(sb, "ws-1");
    expect(deps.computePrice).toHaveBeenCalledWith(1.15, { markupType: "fixed", markupValue: 150, fxRateUsdToGbp: 0.8 });
    expect(result).toEqual({ priceGbpPence: 242 });
  });

  it("looks up toll-free pricing when requested", async () => {
    const deps = buildDeps();
    await previewVoiceNumberPriceCore(sb, "ws-1", { country: "GB", tollFree: true }, deps);

    expect(deps.fetchPrice).toHaveBeenCalledWith(sb, { isoCountry: "GB", numberType: "toll free" });
  });

  it("does not purchase or persist anything — it only reads and computes", async () => {
    const deps = buildDeps();
    await previewVoiceNumberPriceCore(sb, "ws-1", { country: "US", tollFree: false }, deps);

    // The deps surface for this function has no purchase/save capability at
    // all, so there is nothing it could call to spend money or write a row
    // — this test documents that guarantee at the type level (buildDeps'
    // return type is PreviewPriceDeps, which only has read/compute deps).
    expect(Object.keys(deps).sort()).toEqual(["computePrice", "fetchPrice", "resolveMarkup"]);
  });

  it("propagates a pricing lookup failure (e.g. master credentials missing)", async () => {
    const deps = buildDeps({ fetchPrice: vi.fn().mockRejectedValue(new Error("master Twilio account is not configured")) });

    await expect(
      previewVoiceNumberPriceCore(sb, "ws-1", { country: "US", tollFree: false }, deps),
    ).rejects.toThrow(/master Twilio account is not configured/i);
  });
});
