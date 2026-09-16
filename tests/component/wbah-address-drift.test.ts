import { describe, expect, it } from "vitest";
import { preserveWbahAddressAgainstDictationDrift } from "@/lib/wbah/post-call/wbah-uk-address.shared";

describe("preserveWbahAddressAgainstDictationDrift", () => {
  it("keeps the CRM spelling when the call only re-heard the same place", () => {
    // call_737e10b06ced477f741a1a31ec5: the lead's own web form said
    // "Bamber Bridge"; the call wrote back "Bamba Bridge".
    const patch: Record<string, unknown> = { new_propinfo_street3: "Bamba Bridge" };
    const dropped = preserveWbahAddressAgainstDictationDrift(patch, {
      new_propinfo_street3: "Bamber Bridge",
    });
    expect(dropped).toEqual(["new_propinfo_street3"]);
    expect(patch.new_propinfo_street3).toBeUndefined();
  });

  it("writes through a genuine move to a different street", () => {
    const patch: Record<string, unknown> = { address1_line1: "22 Oak Street" };
    expect(
      preserveWbahAddressAgainstDictationDrift(patch, { address1_line1: "14 Bluebell Way" }),
    ).toEqual([]);
    expect(patch.address1_line1).toBe("22 Oak Street");
  });

  it("writes through a corrected number even when the words are identical", () => {
    // Numbers are the part of an address people actually correct on a call.
    const patch: Record<string, unknown> = { new_propinfo_street2: "Flat 22, 108 Thornton Road" };
    expect(
      preserveWbahAddressAgainstDictationDrift(patch, {
        new_propinfo_street2: "Flat 21, 108 Thornton Road",
      }),
    ).toEqual([]);
    expect(patch.new_propinfo_street2).toBe("Flat 22, 108 Thornton Road");
  });

  it("fills an empty CRM field rather than protecting it", () => {
    const patch: Record<string, unknown> = { address1_city: "Preston" };
    expect(preserveWbahAddressAgainstDictationDrift(patch, { address1_city: null })).toEqual([]);
    expect(patch.address1_city).toBe("Preston");
  });

  it("ignores case and surrounding whitespace rather than counting them as drift", () => {
    const patch: Record<string, unknown> = { address1_county: "  lancashire " };
    expect(
      preserveWbahAddressAgainstDictationDrift(patch, { address1_county: "Lancashire" }),
    ).toEqual([]);
  });

  it("never touches non-address fields or a missing lead read", () => {
    const patch: Record<string, unknown> = { cos_call_summary: "totally different text" };
    expect(
      preserveWbahAddressAgainstDictationDrift(patch, { cos_call_summary: "original" }),
    ).toEqual([]);
    expect(preserveWbahAddressAgainstDictationDrift(patch, null)).toEqual([]);
    expect(patch.cos_call_summary).toBe("totally different text");
  });
});
