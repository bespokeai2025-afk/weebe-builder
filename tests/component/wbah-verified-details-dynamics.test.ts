import { describe, expect, it } from "vitest";
import {
  applyVacantOrTenantedToPayload,
  mapWbahVerifiedDetailsToDynamicsFields,
} from "@/lib/wbah/post-call/wbah-verified-details-dynamics.shared";
import { buildWbahAgenticCrmPayload } from "@/lib/wbah/post-call/wbah-crm-payload.shared";

describe("mapWbahVerifiedDetailsToDynamicsFields", () => {
  it("maps on_market and decision_maker", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        on_market: "181510001",
        decision_maker: "true",
        firstname: "Wendy",
      },
    });
    expect(patch.cos_onthemarket).toBe(181510001);
    expect(patch.decisionmaker).toBe(true);
    expect(patch.firstname).toBe("Wendy");
  });

  it("derives vacant property flags from vacant_or_tenanted", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: { vacant_or_tenanted: "181510000" },
    });
    expect(patch.cos_propertyempty).toBe(181510001);
    expect(patch.cos_propertyrented).toBe(181510000);
  });

  it("maps leasehold financials when tenure is leasehold", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        tenure: "279640001",
        cos_groundrent: "2000",
        cos_numberofyearsonlease: "85",
      },
    });
    expect(patch.cos_tenure).toBe(279640001);
    expect(patch.cos_groundrent).toBe(2000);
    expect(patch.cos_numberofyearsonlease).toBe(85);
  });
});

describe("applyVacantOrTenantedToPayload", () => {
  it("maps rented correctly", () => {
    const target: Record<string, unknown> = {};
    applyVacantOrTenantedToPayload(target, "181510001");
    expect(target.cos_propertyempty).toBe(181510000);
    expect(target.cos_propertyrented).toBe(181510001);
  });
});

describe("buildWbahAgenticCrmPayload", () => {
  it("includes cos_onthemarket and decisionmaker from verified_details", () => {
    const patch = buildWbahAgenticCrmPayload({
      verified_details: {
        on_market: "181510001",
        decision_maker: "false",
        cos_tenure: "279640000",
      },
    });
    expect(patch.cos_onthemarket).toBe(181510001);
    expect(patch.decisionmaker).toBe(false);
    expect(patch.cos_tenure).toBe(279640000);
  });
});
