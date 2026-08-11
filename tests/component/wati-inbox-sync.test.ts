import { describe, expect, it } from "vitest";
import { parseWatiV1InboxMessage } from "@/lib/whatsapp/wati-inbox-sync.server";

describe("parseWatiV1InboxMessage", () => {
  it("maps customer inbound text messages", () => {
    const parsed = parseWatiV1InboxMessage(
      {
        eventType: "message",
        owner: false,
        type: "text",
        text: "Tell me more",
        id: "abc123",
        created: "2026-07-24T10:31:18.867Z",
      },
      "919964919000",
    );
    expect(parsed?.direction).toBe("inbound");
    expect(parsed?.body).toBe("Tell me more");
    expect(parsed?.external_id).toBe("abc123");
  });

  it("maps bot auto-reply broadcast messages as outbound bot", () => {
    const parsed = parseWatiV1InboxMessage(
      {
        eventType: "broadcastMessage",
        finalText:
          "Hi arjun, This is an auto-reply message. We have received your message and we have assigned to our agent.",
        id: "bot-msg-1",
        created: "2026-07-24T10:30:39.000Z",
        statusString: "READ",
      },
      "919964919000",
    );
    expect(parsed?.direction).toBe("outbound");
    expect(parsed?.sender_channel).toBe("bot");
    expect(parsed?.body).toContain("auto-reply");
  });

  it("maps template broadcast messages as outbound campaign", () => {
    const parsed = parseWatiV1InboxMessage(
      {
        eventType: "broadcastMessage",
        finalText: "Hello Arjav,\n\nThis is Khisha from Avenue 7.",
        id: "tpl-msg-1",
        created: "2026-07-31T09:20:50.238Z",
      },
      "919964919000",
    );
    expect(parsed?.direction).toBe("outbound");
    expect(parsed?.sender_channel).toBe("campaign");
  });

  it("skips ticket system events", () => {
    expect(
      parseWatiV1InboxMessage(
        {
          eventType: "ticket",
          type: 4,
          eventDescription: "The chat has been expired",
          id: "ticket-1",
        },
        "919964919000",
      ),
    ).toBeNull();
  });

  it("maps WATI agent outbound messages", () => {
    const parsed = parseWatiV1InboxMessage(
      {
        eventType: "message",
        owner: true,
        operatorName: "Khisha",
        text: "Thanks for your interest!",
        id: "agent-1",
        created: "2026-07-24T11:00:00.000Z",
      },
      "919964919000",
    );
    expect(parsed?.direction).toBe("outbound");
    expect(parsed?.sender_channel).toBe("wati");
    expect(parsed?.body).toBe("Thanks for your interest!");
  });
});
