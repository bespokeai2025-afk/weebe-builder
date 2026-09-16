import { describe, expect, it } from "vitest";
import { rejectsAsUkPostcode, looksLikeUkPostcode } from "@/lib/wbah/post-call/wbah-uk-address.shared";
import { normalizeWbahAgenticCrmFields } from "@/lib/wbah/post-call/wbah-agentic-crm-normalize.shared";

describe("rejectsAsUkPostcode", () => {
  it("rejects the garbled dictation that overwrote a valid postcode", () => {
    // call_737e10b06ced477f741a1a31ec5: "P R five six X Q" transcribed as
    // "KR562", which replaced the correct "PR5 6XQ" already on the lead.
    expect(looksLikeUkPostcode("KR562")).toBe(false);
    expect(rejectsAsUkPostcode("new_propinfo_postalcode", "KR562")).toBe(true);
    expect(rejectsAsUkPostcode("address1_postalcode", "KR562")).toBe(true);
  });

  it("accepts real postcodes, spaced or not", () => {
    for (const pc of ["PR5 6XQ", "BD12DX", "HP9 2TU", "m14 5pq"]) {
      expect(rejectsAsUkPostcode("new_propinfo_postalcode", pc)).toBe(false);
    }
  });

  it("never interferes with non-postcode attributes", () => {
    expect(rejectsAsUkPostcode("new_propinfo_city", "KR562")).toBe(false);
    expect(rejectsAsUkPostcode("address1_line1", "14 Bluebell Way")).toBe(false);
  });
});

describe("agentic normalizer — postcode screening", () => {
  const verified = {
    new_propinfo_street2: "14 Bluebell Way",
    new_propinfo_street3: "Bamba Bridge",
    new_propinfo_postalcode: "KR562",
    firstname: "David",
  };

  it("drops a garbled postcode instead of writing it over good CRM data", () => {
    const out = normalizeWbahAgenticCrmFields({ verified_details: verified });
    expect(out.new_propinfo_postalcode).toBeUndefined();
    // Everything else still goes through — only the postcode is withheld.
    expect(out.new_propinfo_street2).toBe("14 Bluebell Way");
    expect(out.firstname).toBe("David");
  });

  it("does not let the same-as-property mirror smuggle it into the contact field", () => {
    const out = normalizeWbahAgenticCrmFields(
      { verified_details: verified },
      undefined,
      null,
      { contact_same_as_property: "true" },
    );
    expect(out.address1_postalcode).toBeUndefined();
    // The mirror itself still works for the fields that are valid.
    expect(out.address1_line1).toBe("14 Bluebell Way");
    expect(out.new_propinfo_sameascontactaddress).toBe(true);
  });

  it("still writes a valid postcode through both property and contact fields", () => {
    const out = normalizeWbahAgenticCrmFields(
      { verified_details: { ...verified, new_propinfo_postalcode: "PR5 6XQ" } },
      undefined,
      null,
      { contact_same_as_property: "true" },
    );
    expect(out.new_propinfo_postalcode).toBe("PR5 6XQ");
    expect(out.address1_postalcode).toBe("PR5 6XQ");
  });
});
