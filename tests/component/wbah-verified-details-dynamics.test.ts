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

  it("does not copy property address when contact fields are empty and property incomplete", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        new_propinfo_street2: "10 Upping Street",
        new_propinfo_city: "London",
        address1_line1: "",
        address1_city: "",
        address1_postalcode: "",
      },
    });
    expect(patch.address1_line1).toBeUndefined();
    expect(patch.address1_city).toBeUndefined();
  });

  it("does not copy property to contact when contact blank without same-as confirmation", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        new_propinfo_street2: "10 Upping Street",
        new_propinfo_city: "London",
        new_propinfo_postalcode: "SW1A 2AA",
        address1_line1: "",
        address1_city: "",
        address1_postalcode: "",
      },
    });
    expect(patch.address1_line1).toBeUndefined();
    expect(patch.address1_city).toBeUndefined();
    expect(patch.address1_postalcode).toBeUndefined();
  });

  it("moves postcode out of property street line (Patricia Stocker pattern)", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        new_propinfo_street2: "M14 5PQ",
        new_propinfo_city: "Manchester",
        new_propinfo_postalcode: "",
      },
    });
    expect(patch.new_propinfo_street2).toBeNull();
    expect(patch.new_propinfo_postalcode).toBe("M14 5PQ");
    expect(patch.new_propinfo_city).toBe("Manchester");
  });

  it("normalizes double-plus mobile numbers", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        mobilephone: "++447712461000",
      },
    });
    expect(patch.mobilephone).toBe("07712461000");
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
    expect(patch.address1_postalcode).toBe("SW1A 2AA");
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

  it("copies contact address when summary confirms same as property (Sean pattern)", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        new_propinfo_street2: "22 Elm Close",
        new_propinfo_city: "Leeds",
        new_propinfo_postalcode: "LS1 4AB",
        address1_line1: "",
        address1_city: "",
        address1_postalcode: "",
      },
      custom: {
        detailed_call_summary:
          "Caller confirmed contact address is the same as the property address.",
      },
    });
    expect(patch.address1_line1).toBe("22 Elm Close");
    expect(patch.address1_city).toBe("Leeds");
    expect(patch.address1_postalcode).toBe("LS1 4AB");
  });

  it("extracts tenure and timeframe from summary when structured fields empty (Sarah pattern)", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        firstname: "Sarah",
      },
      custom: {
        detailed_call_summary:
          "Property is leasehold. Caller wants to sell within 2 months. Monthly rent achieved £950.",
      },
    });
    expect(patch.cos_tenure).toBe(279640001);
    expect(patch.new_propinfo_howquickly).toBe(100000002);
    expect(patch.new_propinfo_rentachieved).toBeUndefined();
  });

  it("corrects owner-occupied when summary says caller lives there (Andrew pattern)", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        vacant_or_tenanted: "181510001",
      },
      custom: {
        detailed_call_summary: "Andrew is living at the property — owner occupied, not rented out.",
      },
    });
    expect(patch.cos_propertyempty).toBe(181510000);
    expect(patch.cos_propertyrented).toBe(181510000);
  });

  it("maps Ben Keen call — human callback, contact from transcript, owner occupied, postcode", () => {
    const verifiedDetails = {
      property_type: "100000010",
      vacant_or_tenanted: "181510000",
      tenure: "279640001",
      floor: "100000000",
      timeframe: "100000000",
      new_propinfo_street2: "Apartment Two, Richmond House",
      new_propinfo_street3: "Welland Road",
      new_propinfo_city: "",
      new_propinfo_postalcode: "DE655NR",
      address1_line1: "",
      address1_city: "",
      address1_postalcode: "",
      firstname: "Ben",
      lastname: "Keen",
      emailaddress1: "benjaminkeene15@gmail.com",
      mobilephone: "07572414290",
      decision_maker: "true",
      cos_numberofyearsonlease: "130",
      cos_call_summary:
        "Ground floor leasehold apartment at Apartment Two, Richmond House, Welland Road DE655NR; user lives there; timeframe less than 1 month; decision maker confirmed; human callback scheduled for 27 August 9:00 AM UK.",
    };
    const transcript =
      "Are your contact address details the same as your property address? Yeah. I live in it. Get a real person to call me.";
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails,
      custom: {
        detailed_call_summary:
          "The user requested a callback from a real person for tomorrow morning at 9:00 AM UK time.",
      },
      transcript,
    });
    expect(patch.address1_line1).toBe("Apartment Two, Richmond House");
    expect(patch.address1_line2).toBe("Welland Road");
    expect(patch.new_propinfo_postalcode).toBe("DE65 5NR");
    expect(patch.address1_postalcode).toBe("DE65 5NR");
    expect(patch.mobilephone).toBe("07572414290");
    expect(patch.cos_propertyempty).toBe(181510000);
    expect(patch.cos_propertyrented).toBe(181510000);
    expect(patch.cos_tenure).toBe(279640001);
  });

  it("does not mark rented when the caller said no", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        vacant_or_tenanted: "181510001",
        cos_propertyrented: "181510001",
        cos_propertyempty: "181510000",
      },
      custom: {
        detailed_call_summary:
          "The agent asked if the property is currently rented. The caller said no.",
      },
      transcript: "Is the property currently rented? User: No.",
    });
    expect(patch.cos_propertyrented).toBe(181510000);
  });

  it("does not infer rented from the agent asking currently rented", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {},
      custom: {
        detailed_call_summary:
          "The agent asked whether the property is currently rented. The caller said no, it is not rented.",
      },
    });
    expect(patch.cos_propertyrented).toBe(181510000);
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
    expect(patch.address1_postalcode).toBe("SW1A 2AA");
  });

  it("moves a postcode out of city (Almas D N12 1LG)", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        new_propinfo_street2: "Woodman Terrace",
        new_propinfo_city: "D N12 1LG",
        new_propinfo_postalcode: "DN12 1LG",
      },
    });
    expect(patch.new_propinfo_street2).toBe("Woodman Terrace");
    expect(patch.new_propinfo_postalcode).toBe("DN12 1LG");
    expect(patch.new_propinfo_city).toBeNull();
  });

  it("moves a postcode out of street2 (Charlotte TW14BH)", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        new_propinfo_street2: "TW14BH",
        new_propinfo_postalcode: "",
      },
    });
    expect(patch.new_propinfo_street2).toBeNull();
    expect(patch.new_propinfo_postalcode).toBe("TW1 4BH");
  });

  it("drops spaced STT email and staff mailbox examples", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        emailaddress1: "kieron@webuyanyhouse.co.uk",
      },
      fallbackEmail: "alma smarcer@hotmail.co.uk",
    });
    expect(patch.emailaddress1).toBeUndefined();
  });

  it("prefers valid verified email over broken email_address", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        emailaddress1: "almasmarcer@hotmail.co.uk",
        email_address: "alma smarcer@hotmail.co.uk",
      },
    });
    expect(patch.emailaddress1).toBe("almasmarcer@hotmail.co.uk");
  });

  it("drops extra-digit UK mobiles (Charlotte 074849738276)", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: { mobilephone: "074849738276" },
    });
    expect(patch.mobilephone).toBeUndefined();
  });

  it("corrects currently lived-in as owner occupied", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        vacant_or_tenanted: "181510000",
        cos_propertyempty: "181510000",
        cos_propertyrented: "181510001",
      },
      custom: {
        detailed_call_summary:
          "Three-bedroom semi-detached house currently lived in by the caller, not on the market.",
      },
    });
    expect(patch.cos_propertyempty).toBe(181510000);
    expect(patch.cos_propertyrented).toBe(181510000);
  });
});
