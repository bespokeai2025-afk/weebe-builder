import { describe, expect, it } from "vitest";
import {
  buildWatiConversationPhoneVariants,
  extractWatiConversationMessageText,
  matchWatiConversationMessageText,
} from "@/lib/whatsapp/wati-inbox-enrich.server";

describe("extractWatiConversationMessageText", () => {
  it("returns rendered template text from WATI message row", () => {
    expect(
      extractWatiConversationMessageText({
        text: "Hello Arjav, This is Khisha from Avenue 7.",
        type: "text",
        owner: true,
      }),
    ).toBe("Hello Arjav, This is Khisha from Avenue 7.");
  });

  it("ignores template shorthand text", () => {
    expect(
      extractWatiConversationMessageText({
        text: "[Template: sport_city] Arjav · Khisha",
      }),
    ).toBeNull();
  });
});

describe("matchWatiConversationMessageText", () => {
  const watiMessages = [
    {
      text: "Hello Arjav, This is Khisha from Avenue 7. We noticed your property in JVC Diamond Views.",
      local_message_id: "88aed3c93a050b3c53978463",
      owner: true,
      type: "text",
      timestamp: "2026-07-31T10:25:44.000Z",
    },
  ];

  it("matches by local_message_id", () => {
    expect(
      matchWatiConversationMessageText(
        { external_id: "88aed3c93a050b3c53978463", direction: "outbound" },
        watiMessages,
      ),
    ).toBe(
      "Hello Arjav, This is Khisha from Avenue 7. We noticed your property in JVC Diamond Views.",
    );
  });

  it("matches by sent_at proximity", () => {
    expect(
      matchWatiConversationMessageText(
        {
          external_id: "",
          direction: "outbound",
          sent_at: "2026-07-31T10:25:44.100Z",
        },
        watiMessages,
      ),
    ).toContain("Hello Arjav");
  });
});

describe("buildWatiConversationPhoneVariants", () => {
  it("includes UAE country code variants", () => {
    const variants = buildWatiConversationPhoneVariants("501234567");
    expect(variants).toContain("501234567");
    expect(variants).toContain("971501234567");
  });

  it("includes India country code variants", () => {
    const variants = buildWatiConversationPhoneVariants("919964919000");
    expect(variants).toContain("919964919000");
    expect(variants).toContain("9964919000");
    expect(variants).toContain("+919964919000");
  });
});
