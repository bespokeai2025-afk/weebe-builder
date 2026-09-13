import { describe, expect, it } from "vitest";
import {
  applyContactAddressSameAsProperty,
  applyVacantOrTenantedToPayload,
  mapWbahVerifiedDetailsToDynamicsFields,
} from "@/lib/wbah/post-call/wbah-verified-details-dynamics.shared";
import { buildWbahAgenticCrmPayload } from "@/lib/wbah/post-call/wbah-crm-payload.shared";
import { transcriptIndicatesContactSameAsProperty } from "@/lib/wbah/post-call/wbah-crm-enrichment.shared";

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

  it("copies property to contact when caller answers yes after the same-as question", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        new_propinfo_street2: "49 Mid Summer Avenue",
        new_propinfo_city: "Hounslow",
        new_propinfo_postalcode: "TW45AY",
        address1_line1: "",
        address1_city: "",
        address1_postalcode: "",
      },
      transcript:
        "Is your contact address the same as your property address at forty nine Mid Summer Avenue? Yes.",
    });
    expect(patch.address1_line1).toBe("49 Mid Summer Avenue");
    expect(patch.address1_city).toBe("Hounslow");
    expect(patch.address1_postalcode).toBe("TW4 5AY");
  });

  it("does not copy property to contact when caller says no after the same-as question", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        new_propinfo_street2: "25 Marches Drive",
        new_propinfo_city: "Armadale",
        new_propinfo_postalcode: "EH482PH",
        address1_line1: "183 West Main Street",
        address1_city: "Armadale",
        address1_postalcode: "EH48382HY3",
      },
      transcript: "Are your contact address details the same as your property address? No.",
    });
    expect(patch.address1_line1).toBe("183 West Main Street");
    expect(patch.address1_postalcode).toBeUndefined();
  });

  it("copies remaining contact fields when only the matching postcode was captured", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        new_propinfo_street2: "50 Stamford Avenue",
        new_propinfo_city: "Blackpool",
        new_propinfo_postalcode: "FY4 2BJ",
        address1_line1: "",
        address1_city: "",
        address1_postalcode: "FY4 2BJ",
      },
    });
    expect(patch.address1_line1).toBe("50 Stamford Avenue");
    expect(patch.address1_city).toBe("Blackpool");
    expect(patch.address1_postalcode).toBe("FY4 2BJ");
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

  it("extracts tenure, timeframe, and rent achieved from summary when structured fields empty (Sarah pattern)", () => {
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
    expect(patch.new_propinfo_rentachieved).toBe(950);
  });

  it("maps rent_achieved / monthly_rent extraction keys to new_propinfo_rentachieved", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        firstname: "Alec",
        rent_achieved: "£875",
      },
    });
    expect(patch.new_propinfo_rentachieved).toBe(875);
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

describe("transcriptIndicatesContactSameAsProperty — role-labeled transcripts", () => {
  it("catches a bare 'Yes' reply on a real Agent/User transcript regardless of question length", () => {
    const transcript =
      "Agent: Great, thanks for confirming those details about the property, the number of bedrooms and the tenure. " +
      "Now, one last thing — is your contact address the same as the property address we discussed earlier?\n" +
      "User: Yes.\nAgent: Perfect, thank you.";
    expect(transcriptIndicatesContactSameAsProperty(transcript)).toBe(true);
  });

  it("catches short affirmations beyond 'yes/yeah/yep' (correct, exactly, that's right)", () => {
    for (const reply of ["Correct.", "Exactly.", "That's right.", "Yup.", "Sure."]) {
      const transcript = `Agent: Is your contact address the same as your property address?\nUser: ${reply}\nAgent: Thanks.`;
      expect(transcriptIndicatesContactSameAsProperty(transcript)).toBe(true);
    }
  });

  it("does not confirm on a negative reply even when a later turn mentions an unrelated 'no'", () => {
    const transcript =
      "Agent: Is your contact address the same as your property address?\n" +
      "User: No, I live somewhere else.\n" +
      "Agent: Okay, what is your contact address?\nUser: 12 Elm Street.";
    expect(transcriptIndicatesContactSameAsProperty(transcript)).toBe(false);
  });

  it("does not let an unrelated 'not' several turns later flip a genuine 'yes'", () => {
    const transcript =
      "Agent: Is your contact address the same as your property address?\n" +
      "User: Yes, that's correct.\n" +
      "Agent: Thanks. Is the property currently rented?\nUser: No, it's not rented.";
    expect(transcriptIndicatesContactSameAsProperty(transcript)).toBe(true);
  });

  it("catches 'address IS the same' phrasing (auxiliary verb between address and same)", () => {
    const transcript =
      "Agent: Just to confirm, your contact address is the same as your property address?\n" +
      "User: Yeah.\nAgent: Great, thank you.";
    expect(transcriptIndicatesContactSameAsProperty(transcript)).toBe(true);
  });

  it("Emma Mayo pattern — bare 'Yeah.' reply, with a garbled/unintelligible second utterance afterward", () => {
    // Real production transcript: caller says "Yeah." immediately after the
    // question (before the agent even finishes the "if not..." half of its
    // sentence), then a second, ASR-garbled utterance ("Well, that's the
    // sign" — almost certainly a mis-transcription of "the same") follows
    // once the agent finishes asking for a contact postcode. The first
    // "Yeah." alone must be enough — no reliance on decoding the garbled part.
    const transcript =
      "Agent: Are your contact address details the same as your property address, Emma? If\n" +
      "User: Yeah.\n" +
      "Agent: not, could you please let me know your contact postcode?\n" +
      "User: Well, that's the sign.\n" +
      "Agent: Could you tell me what type of property it is, Emma?";
    expect(transcriptIndicatesContactSameAsProperty(transcript)).toBe(true);
  });

  it("falls back to the plain-text window match when there are no speaker labels", () => {
    const transcript =
      "Is your contact address the same as your property address at forty nine Mid Summer Avenue? Yes.";
    expect(transcriptIndicatesContactSameAsProperty(transcript)).toBe(true);
  });
});

describe("mapWbahVerifiedDetailsToDynamicsFields — dynVars priority", () => {
  it("mirrors the property address when a Retell conversation-flow node set contact_same_as_property live", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        new_propinfo_street2: "12 High Street",
        new_propinfo_city: "Thorley",
        new_propinfo_postalcode: "PO41 0AA",
      },
      dynVars: { contact_same_as_property: "true" },
    });
    expect(patch.address1_line1).toBe("12 High Street");
    expect(patch.address1_city).toBe("Thorley");
    expect(patch.address1_postalcode).toBe("PO41 0AA");
  });

  it("does not mirror when the dynamic variable says false and no other confirmation exists", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        new_propinfo_street2: "12 High Street",
      },
      dynVars: { contact_same_as_property: "false" },
    });
    expect(patch.address1_line1).toBeUndefined();
  });

  it("does not let a live dynVar override an explicit post-call verified_details value", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        new_propinfo_street2: "12 High Street",
        contact_same_as_property: "false",
      },
      dynVars: { contact_same_as_property: "true" },
    });
    expect(patch.address1_line1).toBeUndefined();
  });
});

describe("mapWbahVerifiedDetailsToDynamicsFields — Arjo Virani test call (live Extract Variable node)", () => {
  it("mirrors the property address using the live dynVar even though post-call verified_details omits contact_same_as_property entirely", () => {
    // Real test call after wiring the new Retell "Extract Variables" node:
    // the tool response showed {{contact_same_as_property}}=true live during
    // the call, but the post-call structured_json_output still came back
    // with no contact_same_as_property key at all (same gap as every prior
    // case) and empty address1_* fields. This is precisely what the dynVars
    // priority path exists for.
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        new_propinfo_street2: "Twelve Midnight Street",
        new_propinfo_city: "Manchester",
        new_propinfo_postalcode: "PNG123",
        address1_line1: "",
        address1_city: "",
        address1_postalcode: "",
        // No contact_same_as_property key — matches the real post-call JSON.
      },
      dynVars: { contact_same_as_property: "true" },
    });
    expect(patch.address1_line1).toBe("Twelve Midnight Street");
    expect(patch.address1_city).toBe("Manchester");
  });
});

describe("mapWbahVerifiedDetailsToDynamicsFields — Emma Mayo pattern (real production verified_details)", () => {
  it("mirrors the property address end-to-end from Emma Mayo's exact verified_details + transcript", () => {
    const transcript =
      "Agent: Are your contact address details the same as your property address, Emma? If\n" +
      "User: Yeah.\n" +
      "Agent: not, could you please let me know your contact postcode?\n" +
      "User: Well, that's the sign.\n" +
      "Agent: Could you tell me what type of property it is, Emma?";
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        new_propinfo_street2: "Three Brynwood Drive",
        new_propinfo_street3: "",
        new_propinfo_city: "Newtown",
        address1_line1: "",
        address1_line2: "",
        address1_city: "",
        new_propinfo_postalcode: "SY162EG",
        address1_postalcode: "",
        // No contact_same_as_property key — matches the real extraction.
      },
      transcript,
    });
    expect(patch.address1_line1).toBe("Three Brynwood Drive");
    expect(patch.address1_postalcode).toBe("SY16 2EG");
  });
});

describe("mapWbahVerifiedDetailsToDynamicsFields — Cedric Coupland pattern (phonetic contact postcode)", () => {
  it("accepts a contact postcode with stray punctuation from phonetic-alphabet dictation", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        new_propinfo_street2: "109B Saint Andrews Road",
        new_propinfo_city: "South C",
        new_propinfo_postalcode: "PO51ES",
        // Extraction sometimes leaves punctuation around phonetic letters.
        address1_postalcode: "P.O.12-2N.G",
        contact_same_as_property: "false",
      },
    });
    expect(patch.address1_postalcode).toBe("PO12 2NG");
    // No street was ever asked for when the caller only gave a postcode —
    // address1_line1 correctly stays unset rather than being guessed at.
    expect(patch.address1_line1).toBeUndefined();
  });

  it("Joanne Ryder-Maddocks pattern — mirrors when Retell omits contact_same_as_property entirely but the transcript has a clear double confirmation", () => {
    // Real production case: Retell's structured_json_output left out
    // contact_same_as_property altogether (not even ""), despite the caller
    // confirming twice ("Yes." then "It's the same.") right after the
    // question. Only the transcript-based turn detector can catch this.
    const transcript =
      "Agent: Could I just confirm, are your contact address details the same as your property address? If\n" +
      "User: Yes.\n" +
      "Agent: not, could you please provide your contact postcode, spelling it out with the phonetic alphabet?\n" +
      "User: It's the same.\n" +
      "Agent: Could you tell me the type of property you're looking to sell?";
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        new_propinfo_street2: "Forty seven Ogden Crescent",
        new_propinfo_street3: "Denholm",
        new_propinfo_postalcode: "VD13 4LD",
        // No contact_same_as_property key at all, and no address1_* given —
        // matches the real extraction exactly.
      },
      transcript,
    });
    expect(patch.address1_line1).toBe("Forty seven Ogden Crescent");
    expect(patch.address1_postalcode).toBe("VD13 4LD");
  });

  it("does not mirror the property address when contact_same_as_property is false, even with a different postcode given", () => {
    const patch = mapWbahVerifiedDetailsToDynamicsFields({
      verifiedDetails: {
        new_propinfo_street2: "109B Saint Andrews Road",
        new_propinfo_postalcode: "PO51ES",
        address1_postalcode: "PO122NG",
        contact_same_as_property: "false",
      },
    });
    expect(patch.address1_postalcode).toBe("PO12 2NG");
    expect(patch.address1_line1).toBeUndefined();
  });
});
