import { describe, expect, it } from "vitest";
import { pickWbahCrmEmail } from "@/lib/wbah/post-call/wbah-email.shared";
import { formatWbahRetellCallData } from "@/lib/wbah/post-call/wbah-format-data.shared";
import { normalizeWbahUkMobilePhone } from "@/lib/wbah/post-call/wbah-uk-phone.shared";

describe("pickWbahCrmEmail", () => {
  it("drops spaced STT and staff example mailboxes", () => {
    expect(pickWbahCrmEmail("alma smarcer@hotmail.co.uk")).toBeNull();
    expect(pickWbahCrmEmail("kieron@webuyanyhouse.co.uk")).toBeNull();
  });

  it("prefers verified_details over broken analysis email", () => {
    expect(
      pickWbahCrmEmail("almasmarcer@hotmail.co.uk", "alma smarcer@hotmail.co.uk"),
    ).toBe("almasmarcer@hotmail.co.uk");
  });
});

describe("formatWbahRetellCallData email", () => {
  it("uses verified emailaddress1 not broken email_address (Almas)", () => {
    const formatted = formatWbahRetellCallData({
      dynVars: { email: "" },
      custom: {
        email_address: "alma smarcer@hotmail.co.uk",
        structured_json_output: JSON.stringify({
          verified_details: { emailaddress1: "almasmarcer@hotmail.co.uk" },
        }),
      },
    });
    expect(formatted.email).toBe("almasmarcer@hotmail.co.uk");
  });
});

describe("normalizeWbahUkMobilePhone", () => {
  it("rejects extra-digit numbers", () => {
    expect(normalizeWbahUkMobilePhone("074849738276")).toBe("");
  });

  it("keeps valid UK mobiles", () => {
    expect(normalizeWbahUkMobilePhone("+447920094238")).toBe("07920094238");
  });
});
