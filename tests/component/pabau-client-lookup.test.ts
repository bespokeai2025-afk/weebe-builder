import { describe, expect, it } from "vitest";
import {
  pabauPhoneSearchVariants,
  parsePabauClientRow,
} from "@/lib/pabau/pabau-client-lookup.shared";

describe("pabau-client-lookup", () => {
  it("builds UK phone search variants", () => {
    const v = pabauPhoneSearchVariants("+447732773843");
    expect(v).toContain("07732773843");
    expect(v).toContain("+447732773843");
  });

  it("parses nested Pabau client row", () => {
    const row = {
      details: { id: 42051567, first_name: "Samantha", last_name: "Chesters" },
      communications: { mobile: "07732773843", email: "a@b.com" },
    };
    const parsed = parsePabauClientRow(row);
    expect(parsed?.contact_id).toBe(42051567);
    expect(parsed?.name).toBe("Samantha Chesters");
    expect(parsed?.mobile).toBe("07732773843");
  });
});
