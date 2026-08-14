import { describe, expect, it } from "vitest";

import {
  describeWatiNonTextBody,
  extractWatiContactCardText,
  isWatiNonTextPlaceholderBody,
} from "@/lib/whatsapp/wati-message-content.shared";
import { extractWatiConversationMessageText } from "@/lib/whatsapp/wati-inbox-enrich.server";

/** Exactly the shape WATI's V1 getMessages returns for a shared contact card. */
const WATI_CONTACTS_MESSAGE = {
  type: "contacts",
  eventType: "message",
  owner: false,
  text: null,
  data: null,
  contacts: [
    {
      addresses: null,
      emails: null,
      name: {
        first_name: "Надежда",
        formatted_name: "Никитенкова Надежда",
        last_name: "Никитенкова Надежда",
      },
      phones: [{ phone: "+971 55 113 0687", type: null, wa_id: "971551130687" }],
      origin: "other",
    },
  ],
};

describe("extractWatiContactCardText", () => {
  it("renders a shared contact as WATI shows it, instead of a bare placeholder", () => {
    expect(extractWatiContactCardText(WATI_CONTACTS_MESSAGE)).toBe(
      "Contact: Никитенкова Надежда · +971 55 113 0687",
    );
  });

  it("reads the webhook's messageContact field", () => {
    const text = extractWatiContactCardText({
      type: "contacts",
      messageContact: {
        name: { formatted_name: "Jane Roe" },
        phones: [{ phone: "+971 50 000 0000" }],
      },
    });

    expect(text).toBe("Contact: Jane Roe · +971 50 000 0000");
  });

  it("lists every contact when several are shared at once", () => {
    const text = extractWatiContactCardText({
      type: "contacts",
      contacts: [
        { name: { formatted_name: "Alice" }, phones: [{ phone: "+1 555 0001" }] },
        { name: { formatted_name: "Bob" }, phones: [{ phone: "+1 555 0002" }] },
      ],
    });

    expect(text).toBe("Contacts (2):\nAlice · +1 555 0001\nBob · +1 555 0002");
  });

  it("keeps both numbers when a card carries more than one", () => {
    const text = extractWatiContactCardText({
      contacts: [
        {
          name: { formatted_name: "Alice" },
          phones: [{ phone: "+1 555 0001" }, { phone: "+1 555 0002" }],
        },
      ],
    });

    expect(text).toBe("Contact: Alice · +1 555 0001, +1 555 0002");
  });

  it("builds a name from first and last when no formatted name is sent", () => {
    const text = extractWatiContactCardText({
      contacts: [{ name: { first_name: "Ada", last_name: "Lovelace" }, phones: [] }],
    });

    expect(text).toBe("Contact: Ada Lovelace");
  });

  it("does not repeat the name when WhatsApp echoes it into last_name", () => {
    const text = extractWatiContactCardText({
      contacts: [{ name: { first_name: "Надежда", last_name: "Надежда" } }],
    });

    expect(text).toBe("Contact: Надежда");
  });

  it("parses a vCard when the provider sends one instead of fields", () => {
    const text = extractWatiContactCardText({
      contacts_array: [
        {
          displayName: "Viktor Andreevich",
          vcard:
            "BEGIN:VCARD\nVERSION:3.0\nN:Andreevich;Viktor;;;\nFN:Viktor Andreevich\nitem1.TEL;waid=79001234567:+7 900 123-45-67\nEND:VCARD",
        },
      ],
    });

    expect(text).toBe("Contact: Viktor Andreevich · +7 900 123-45-67");
  });

  it("falls back to the number when only a phone is shared", () => {
    expect(extractWatiContactCardText({ contacts: [{ phones: [{ phone: "+1 555 0001" }] }] })).toBe(
      "Contact: +1 555 0001",
    );
  });

  it("returns null for messages that carry no contact card", () => {
    expect(extractWatiContactCardText({ type: "text", text: "hello" })).toBeNull();
    expect(extractWatiContactCardText({ type: "image", contacts: [] })).toBeNull();
    expect(extractWatiContactCardText({ type: "contacts", contacts: null })).toBeNull();
  });
});

describe("describeWatiNonTextBody", () => {
  it("describes a contact card rather than labelling it [contacts]", () => {
    expect(describeWatiNonTextBody(WATI_CONTACTS_MESSAGE)).toBe(
      "Contact: Никитенкова Надежда · +971 55 113 0687",
    );
  });

  it("names a location", () => {
    expect(
      describeWatiNonTextBody({
        type: "location",
        data: { name: "Burj Khalifa", address: "1 Sheikh Mohammed bin Rashid Blvd" },
      }),
    ).toBe("Location: Burj Khalifa, 1 Sheikh Mohammed bin Rashid Blvd");
  });

  it("falls back to coordinates for an unnamed location", () => {
    expect(
      describeWatiNonTextBody({
        type: "location",
        data: { latitude: 25.1972, longitude: 55.2744 },
      }),
    ).toBe("Location: 25.1972, 55.2744");
  });

  it("shows a document's filename", () => {
    expect(
      describeWatiNonTextBody({ type: "document", data: { fileName: "Floor-plan.pdf" } }),
    ).toBe("Floor-plan.pdf");
  });

  it("still labels media that carries nothing readable", () => {
    // The inbox renders these from media_url, so the label is only a caption.
    expect(describeWatiNonTextBody({ type: "image" })).toBe("[image]");
    expect(describeWatiNonTextBody({ type: "document" })).toBe("[document]");
    expect(describeWatiNonTextBody({ type: "sticker" })).toBe("[sticker]");
    expect(describeWatiNonTextBody({ type: "wildcard" })).toBe("[Non-text message]");
    expect(describeWatiNonTextBody({})).toBe("[Non-text message]");
  });
});

describe("isWatiNonTextPlaceholderBody", () => {
  it("recognises the placeholders we store when a message has no readable content", () => {
    expect(isWatiNonTextPlaceholderBody("[contacts]")).toBe(true);
    expect(isWatiNonTextPlaceholderBody("[image]")).toBe(true);
    expect(isWatiNonTextPlaceholderBody("[Non-text message]")).toBe(true);
  });

  it("does not treat real message text as a placeholder", () => {
    expect(isWatiNonTextPlaceholderBody("Contact: Jane Roe · +971 50 000 0000")).toBe(false);
    expect(isWatiNonTextPlaceholderBody("[see attached]")).toBe(false);
    expect(isWatiNonTextPlaceholderBody("")).toBe(false);
    expect(isWatiNonTextPlaceholderBody(null)).toBe(false);
  });

  it("excludes template shorthand, which has its own enrichment pass", () => {
    expect(isWatiNonTextPlaceholderBody("[Template: welcome_v2]")).toBe(false);
  });
});

describe("extractWatiConversationMessageText", () => {
  it("treats a contact card as content, so the sync no longer discards the message", () => {
    expect(extractWatiConversationMessageText(WATI_CONTACTS_MESSAGE)).toBe(
      "Contact: Никитенкова Надежда · +971 55 113 0687",
    );
  });

  it("still prefers a real text body over a contact card", () => {
    expect(
      extractWatiConversationMessageText({ ...WATI_CONTACTS_MESSAGE, text: "here is her number" }),
    ).toBe("here is her number");
  });

  it("leaves captionless media unresolved, so template bodies are never overwritten", () => {
    expect(extractWatiConversationMessageText({ type: "image", owner: true })).toBeNull();
  });
});
