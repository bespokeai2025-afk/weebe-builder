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

describe("pabauFindClientByPhone — matching against the actual response", () => {
  /**
   * This used to require the search to come back with exactly one row before trusting it. A
   * clinic's client list very commonly has more than one row share close-enough digits (a family
   * member, an old duplicate record), and the moment a second row appeared the match was silently
   * discarded — indistinguishable, to the caller, from "you're not in the system" even though
   * their number was right there in the response.
   */
  const jsonResponse = (body: unknown) =>
    ({ ok: true, text: async () => JSON.stringify(body) }) as Response;

  it("finds the caller among several rows the search returns", async () => {
    global.fetch = (async () =>
      jsonResponse({
        clients: [
          {
            details: { id: 111, first_name: "Someone", last_name: "Else" },
            communications: { mobile: "07700111111" },
          },
          {
            details: { id: 42051567, first_name: "Samantha", last_name: "Chesters" },
            communications: { mobile: "07732773843" },
          },
        ],
      })) as typeof fetch;

    const { pabauFindClientByPhone } = await import("@/lib/pabau/pabau-client-lookup.shared");
    const found = await pabauFindClientByPhone({ apiKey: "test-key" }, "+447732773843");
    expect(found?.contact_id).toBe(42051567);
  });

  it("does not match a row with a genuinely different number", async () => {
    global.fetch = (async () =>
      jsonResponse({
        clients: [
          {
            details: { id: 111, first_name: "Someone", last_name: "Else" },
            communications: { mobile: "07700111111" },
          },
        ],
      })) as typeof fetch;

    const { pabauFindClientByPhone } = await import("@/lib/pabau/pabau-client-lookup.shared");
    const found = await pabauFindClientByPhone({ apiKey: "test-key" }, "+447732773843");
    expect(found).toBeNull();
  });

  it("still trusts a single unambiguous row with no mobile field to verify against", async () => {
    global.fetch = (async () =>
      jsonResponse({
        clients: [{ details: { id: 42051567, first_name: "Samantha", last_name: "Chesters" } }],
      })) as typeof fetch;

    const { pabauFindClientByPhone } = await import("@/lib/pabau/pabau-client-lookup.shared");
    const found = await pabauFindClientByPhone({ apiKey: "test-key" }, "+447732773843");
    expect(found?.contact_id).toBe(42051567);
  });
});
