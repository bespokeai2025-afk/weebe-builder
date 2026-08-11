import { describe, expect, it } from "vitest";
import {
  extractWatiInboundMessageText,
  isWatiInboundMessageEvent,
  isWatiReplyEvent,
  parseWatiReplyWebhookMessage,
} from "@/lib/whatsapp/wati-campaign.server";
import { mapWatiStatusString } from "@/lib/whatsapp/wati-message-status.server";

describe("wati reply webhook", () => {
  it("detects sentMessageREPLIED_v2", () => {
    expect(
      isWatiReplyEvent({
        eventType: "sentMessageREPLIED_v2",
        statusString: "Replied",
        text: "Yes please call me",
      }),
    ).toBe(true);
  });

  it("does not treat reply events as generic inbound message events", () => {
    expect(
      isWatiInboundMessageEvent({
        eventType: "sentMessageREPLIED_v2",
        text: "Yes please call me",
      }),
    ).toBe(false);
  });

  it("parses campaign reply body when phone is resolved separately", () => {
    const parsed = parseWatiReplyWebhookMessage(
      {
        eventType: "sentMessageREPLIED_v2",
        statusString: "Replied",
        text: "Tell me more about the offer",
        whatsappMessageId: "wamid.reply123",
        id: "evt-reply-1",
        timestamp: "1765132600",
        conversationId: "68cba3db12b3349e",
      },
      "971501234567",
    );

    expect(parsed?.contact_phone).toBe("971501234567");
    expect(parsed?.body).toBe("Tell me more about the offer");
    expect(parsed?.external_id).toBe("wamid.reply123");
  });

  it("extracts quick-reply button text", () => {
    expect(
      extractWatiInboundMessageText({
        type: "button",
        buttonReply: { text: "Yes, I'm interested" },
      }),
    ).toBe("Yes, I'm interested");
  });

  it("maps Replied status without confusing it for read", () => {
    expect(mapWatiStatusString("Replied")).toBe("replied");
    expect(mapWatiStatusString("Read")).toBe("read");
  });
});
