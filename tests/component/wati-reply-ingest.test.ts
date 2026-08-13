/**
 * Regressions for the bugs that stopped inbound campaign replies reaching the BuzzChat inbox.
 */
import { describe, expect, it } from "vitest";
import { watiApiV3Base } from "@/lib/whatsapp/wati-api-base.shared";
import {
  extractWatiInboundMessageText,
  extractWatiInteractiveReplyText,
  isWatiOutboundMessageEvent,
  isWatiReplyEvent,
  isWatiStatusEvent,
  parseWatiInboundMessage,
} from "@/lib/whatsapp/wati-campaign.server";
import {
  mapWatiStatusString,
  mapWatiStatusToDbStatus,
} from "@/lib/whatsapp/wati-message-status.server";
import {
  attributeReplyToCampaign,
  parseWatiV1InboxMessage,
} from "@/lib/whatsapp/wati-inbox-sync.server";

describe("watiApiV3Base", () => {
  it("omits the tenant id — V3 resolves the tenant from the bearer token", () => {
    expect(watiApiV3Base("eu-api.wati.io")).toBe("https://eu-api.wati.io/api/ext/v3");
  });

  it("does not embed a tenant path segment for any host", () => {
    expect(watiApiV3Base("live-mt-server.wati.io")).not.toMatch(/wati\.io\/\d+/);
  });
});

describe("extractWatiInteractiveReplyText", () => {
  it("reads quick-reply button taps", () => {
    expect(extractWatiInteractiveReplyText({ buttonReply: { text: "Yes, interested" } })).toBe(
      "Yes, interested",
    );
  });

  it("reads list picks", () => {
    expect(
      extractWatiInteractiveReplyText({
        listReply: { title: "2 bedrooms", description: "Marina" },
      }),
    ).toBe("2 bedrooms");
  });

  it("accepts snake_case from API V3 message rows", () => {
    expect(extractWatiInteractiveReplyText({ button_reply: { text: "Book a viewing" } })).toBe(
      "Book a viewing",
    );
  });

  it("returns null when there is no interactive reply", () => {
    expect(extractWatiInteractiveReplyText({ text: "plain text" })).toBeNull();
  });
});

describe("extractWatiInboundMessageText", () => {
  it("prefers plain text when present", () => {
    expect(extractWatiInboundMessageText({ text: "Call me back" })).toBe("Call me back");
  });

  it("falls back to a button reply", () => {
    expect(extractWatiInboundMessageText({ buttonReply: { text: "Not now" } })).toBe("Not now");
  });
});

describe("parseWatiV1InboxMessage", () => {
  it("captures button replies instead of labelling them non-text", () => {
    const parsed = parseWatiV1InboxMessage(
      {
        type: "button",
        owner: false,
        button_reply: { text: "Yes, interested" },
        id: "btn-1",
        timestamp: "2026-08-12T10:00:00.000Z",
      },
      "971585248237",
    );
    expect(parsed?.direction).toBe("inbound");
    expect(parsed?.body).toBe("Yes, interested");
  });

  it("keeps a REPLIED status out of the message_status enum", () => {
    const parsed = parseWatiV1InboxMessage(
      {
        eventType: "message",
        owner: true,
        text: "Campaign message",
        id: "out-1",
        created: "2026-08-12T09:00:00.000Z",
        statusString: "REPLIED",
      },
      "971585248237",
    );
    expect(parsed?.status).toBe("read");
    expect(parsed?.wati_status).toBe("REPLIED");
  });

  it("detects bot senders from V3 snake_case operator names", () => {
    const parsed = parseWatiV1InboxMessage(
      {
        type: "text",
        owner: true,
        operator_name: "Avenue Bot",
        text: "Auto reply",
        id: "bot-2",
        timestamp: "2026-08-12T09:30:00.000Z",
      },
      "971585248237",
    );
    expect(parsed?.sender_channel).toBe("bot");
  });
});

describe("mapWatiStatusToDbStatus", () => {
  it("coerces REPLIED to read, since message_status has no replied member", () => {
    expect(mapWatiStatusString("REPLIED")).toBe("replied");
    expect(mapWatiStatusToDbStatus("REPLIED")).toBe("read");
  });

  it("passes through statuses that already exist in the enum", () => {
    expect(mapWatiStatusToDbStatus("DELIVERED")).toBe("delivered");
    expect(mapWatiStatusToDbStatus("READ")).toBe("read");
  });

  it("returns null for unrecognised input", () => {
    expect(mapWatiStatusToDbStatus("something-else")).toBeNull();
  });
});

describe("WATI event routing", () => {
  const sessionSent = { eventType: "sessionMessageSent_v2", waId: "971585248237", owner: true };

  it("treats sessionMessageSent_v2 as a message, not a status change", () => {
    expect(isWatiStatusEvent(sessionSent)).toBe(false);
    expect(isWatiOutboundMessageEvent(sessionSent)).toBe(true);
  });

  it("still routes delivery receipts to the status branch", () => {
    expect(isWatiStatusEvent({ eventType: "sentMessageDELIVERED_v2" })).toBe(true);
    expect(isWatiStatusEvent({ eventType: "sentMessageREAD_v2" })).toBe(true);
  });

  it("keeps replies on their own branch", () => {
    expect(isWatiReplyEvent({ eventType: "sentMessageREPLIED_v2" })).toBe(true);
    expect(isWatiStatusEvent({ eventType: "sentMessageREPLIED_v2" })).toBe(false);
  });
});

describe("attributeReplyToCampaign", () => {
  const at = (iso: string) => new Date(iso).getTime();
  const sends = [
    { campaignId: "camp-old", sentAt: at("2026-08-10T09:00:00.000Z") },
    { campaignId: "camp-recent", sentAt: at("2026-08-12T09:00:00.000Z") },
  ];

  it("attributes a reply to the most recent send before it", () => {
    expect(attributeReplyToCampaign("2026-08-12T10:00:00.000Z", sends)).toBe("camp-recent");
  });

  it("ignores sends that happened after the reply", () => {
    expect(attributeReplyToCampaign("2026-08-11T10:00:00.000Z", sends)).toBeNull();
  });

  it("ignores sends outside the 24h session window", () => {
    expect(attributeReplyToCampaign("2026-08-14T10:00:00.000Z", sends)).toBeNull();
  });

  it("returns null when there are no campaign sends", () => {
    expect(attributeReplyToCampaign("2026-08-12T10:00:00.000Z", [])).toBeNull();
  });
});

describe("parseWatiInboundMessage", () => {
  it("captures conversation identity so replies can be matched without an API call", () => {
    const parsed = parseWatiInboundMessage({
      eventType: "message",
      owner: false,
      waId: "971585248237",
      text: "Sounds good",
      id: "in-9",
      conversationId: "conv-123",
      ticketId: "ticket-456",
      created: "2026-08-12T12:00:00.000Z",
    });
    expect(parsed?.conversation_id).toBe("conv-123");
    expect(parsed?.ticket_id).toBe("ticket-456");
  });

  it("labels media messages by type rather than a generic placeholder", () => {
    const parsed = parseWatiInboundMessage({
      eventType: "message",
      owner: false,
      waId: "971585248237",
      type: "image",
      id: "img-1",
      sourceUrl: "https://eu-api.wati.io/media/abc.jpg",
      data: { mimeType: "image/jpeg", fileName: "abc.jpg" },
      created: "2026-08-12T12:05:00.000Z",
    });
    expect(parsed?.body).toBe("[image]");
    expect(parsed?.media_url).toBe("https://eu-api.wati.io/media/abc.jpg");
    expect(parsed?.media_mime_type).toBe("image/jpeg");
    expect(parsed?.media_filename).toBe("abc.jpg");
  });
});
