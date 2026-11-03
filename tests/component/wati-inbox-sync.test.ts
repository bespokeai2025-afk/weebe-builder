import { describe, expect, it } from "vitest";
import {
  mergeWatiMessageLists,
  parseWatiMessageSentAt,
  parseWatiV1InboxMessage,
} from "@/lib/whatsapp/wati-inbox-sync.server";

describe("mergeWatiMessageLists", () => {
  it("keeps V3 inbound when V1 only has outbound", () => {
    const merged = mergeWatiMessageLists(
      [
        {
          id: "out-1",
          owner: true,
          type: "text",
          text: "Hello from campaign",
          created: "2026-08-11T10:00:00.000Z",
        },
      ],
      [
        {
          id: "in-1",
          owner: false,
          type: "text",
          text: "Yes tell me more",
          timestamp: "2026-08-11T11:00:00.000Z",
        },
      ],
    );
    expect(merged).toHaveLength(2);
  });

  it("keeps fields only one API version reports for the same message", () => {
    // A shared contact card only appears on V1's `contacts`; V3 omits the field entirely. Letting
    // V3 replace the record wholesale dropped the card and the message was discarded as empty.
    const contacts = [
      { name: { formatted_name: "Jane Roe" }, phones: [{ phone: "+971 50 000 0000" }] },
    ];
    const merged = mergeWatiMessageLists(
      [{ id: "msg-1", owner: false, type: "contacts", text: null, contacts }],
      [{ id: "msg-1", owner: false, type: "contacts", text: null, statusString: "READ" }],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]!.contacts).toEqual(contacts);
    expect(merged[0]!.statusString).toBe("READ");
  });

  it("does not let a later null overwrite a populated value", () => {
    const merged = mergeWatiMessageLists(
      [{ id: "msg-1", type: "text", text: "the real body" }],
      [{ id: "msg-1", type: "text", text: null }],
    );

    expect(merged[0]!.text).toBe("the real body");
  });
});

describe("parseWatiMessageSentAt", () => {
  it("parses ISO V3 timestamps", () => {
    expect(parseWatiMessageSentAt({ timestamp: "2026-08-11T15:04:13.5980185Z" })).toContain(
      "2026-08-11",
    );
  });
});

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

  it("maps V3-style inbound replies (owner false, type text)", () => {
    const parsed = parseWatiV1InboxMessage(
      {
        type: "text",
        owner: false,
        text: "Interested in selling",
        id: "v3-in-1",
        timestamp: "2026-08-11T15:04:13.5980185Z",
      },
      "971586666612",
    );
    expect(parsed?.direction).toBe("inbound");
    expect(parsed?.body).toBe("Interested in selling");
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

describe("findDuplicateMessage — our campaign send vs WATI's history copy", () => {
  const ours = {
    id: "ours",
    external_id: "lead_0360b7a1-ea3a-4ec3-82da-c77766843663_1a2b3c4d",
    whatsapp_message_id: null,
    sent_at: "2026-11-03T13:23:25.000Z",
    body: "Hi Mr.Ms. Hosam, This is Khisha from Avenue 7. I'm reaching out regarding Tilal Aura",
    direction: "outbound",
    sender_channel: null,
    campaign_id: "acc2e956",
    status: "sent",
  };
  const watiCopy = (over: Record<string, unknown> = {}) =>
    ({
      contact_phone: "+971500000292",
      body: "Hi Mr.Ms. Hosam,  This is Khisha from Avenue 7. I'm reaching out regarding Tilal Aura",
      direction: "outbound",
      external_id: "6ae9e02e0955b5ec072b2656",
      whatsapp_message_id: null,
      sent_at: "2026-11-03T13:22:54.000Z",
      sender_channel: "campaign",
      status: "failed",
      wati_status: "FAILED",
      ...over,
    }) as never;

  it("matches WATI's copy of a message we logged, despite the 31 s gap and spacing", async () => {
    const { findDuplicateMessage } = await import("@/lib/whatsapp/wati-inbox-sync.server");
    expect(findDuplicateMessage(watiCopy(), [ours])?.id).toBe("ours");
  });

  it("does not merge a different message, or one far apart in time", async () => {
    const { findDuplicateMessage } = await import("@/lib/whatsapp/wati-inbox-sync.server");
    expect(findDuplicateMessage(watiCopy({ body: "Hi Hosam, We specialise in Tilal Al Ghaf" }), [ours])).toBeNull();
    expect(findDuplicateMessage(watiCopy({ sent_at: "2026-11-03T15:00:00.000Z" }), [ours])).toBeNull();
  });

  it("never merges into a row WATI already identified (an imported message)", async () => {
    const { findDuplicateMessage } = await import("@/lib/whatsapp/wati-inbox-sync.server");
    const imported = { ...ours, external_id: "6ac61aaa656bd5a1ab3f5543", campaign_id: null };
    expect(findDuplicateMessage(watiCopy(), [imported])).toBeNull();
  });
});
