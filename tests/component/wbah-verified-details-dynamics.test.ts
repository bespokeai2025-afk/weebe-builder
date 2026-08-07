import { describe, expect, it } from "vitest";
import {
  applyContactAddressSameAsProperty,
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

  it("does not copy property address when contact fields are empty without confirmation", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        new_propinfo_street2: "10 Upping Street",
        new_propinfo_city: "London",
        new_propinfo_postalcode: "SW1A2AA",
        address1_line1: "",
        address1_city: "",
        address1_postalcode: "",
      },
    });
    expect(patch.address1_line1).toBeUndefined();
    expect(patch.address1_city).toBeUndefined();
    expect(patch.address1_postalcode).toBeUndefined();
  });

  it("copies property address when caller explicitly confirms same", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        new_propinfo_street2: "10 Upping Street",
        new_propinfo_street3: "Flat 2",
        new_propinfo_city: "London",
        new_propinfo_postalcode: "SW1A2AA",
        contact_same_as_property: "true",
        address1_line1: "",
        address1_line2: "",
        address1_city: "",
        address1_postalcode: "",
      },
    });
    expect(patch.address1_line1).toBe("10 Upping Street");
    expect(patch.address1_line2).toBe("Flat 2");
    expect(patch.address1_city).toBe("London");
    expect(patch.address1_postalcode).toBe("SW1A2AA");
  });

  it("replaces same-as-property placeholder on contact line with property address", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        new_propinfo_street2: "14 Oakwood Avenue",
        new_propinfo_city: "Manchester",
        new_propinfo_postalcode: "M14 5PQ",
        address1_line1: "same as property address",
        address1_city: "",
        address1_postalcode: "",
      },
    });
    expect(patch.address1_line1).toBe("14 Oakwood Avenue");
    expect(patch.address1_city).toBe("Manchester");
    expect(patch.address1_postalcode).toBe("M14 5PQ");
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

describe("applyContactAddressSameAsProperty", () => {
  it("does not copy when contact fields are empty and caller did not confirm same", () => {
    const target: Record<string, unknown> = {};
    applyContactAddressSameAsProperty(target, {
      new_propinfo_street2: "14 Oakwood Avenue",
      new_propinfo_city: "Manchester",
      new_propinfo_postalcode: "M14 5PQ",
    });
    expect(target.address1_line1).toBeUndefined();
    expect(target.address1_postalcode).toBeUndefined();
  });

  it("does not overwrite a distinct contact address", () => {
    const target: Record<string, unknown> = {
      address1_line1: "22 High Street",
      address1_city: "Manchester",
      address1_postalcode: "M1 4BT",
    };
    applyContactAddressSameAsProperty(target, {
      new_propinfo_street2: "14 Oakwood Avenue",
      new_propinfo_city: "Manchester",
      new_propinfo_postalcode: "M14 5PQ",
    });
    expect(target.address1_line1).toBe("22 High Street");
    expect(target.address1_postalcode).toBe("M1 4BT");
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

  it("mirrors property address when explicit same-as-property confirmation is present", () => {
    const patch = buildWbahAgenticCrmPayload({
      verified_details: {
        new_propinfo_street2: "10 Upping Street",
        new_propinfo_city: "London",
        new_propinfo_postalcode: "SW1A2AA",
        contact_same_as_property: "true",
        address1_line1: "",
        address1_city: "",
        address1_postalcode: "",
      },
    });
    expect(patch.address1_line1).toBe("10 Upping Street");
    expect(patch.address1_city).toBe("London");
    expect(patch.address1_postalcode).toBe("SW1A2AA");
  });
});
