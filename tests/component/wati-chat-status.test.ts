/**
 * WATI chat status parity — the "Expired"/"Open"/"Solved" chips WATI shows on each chat, plus the
 * sync rotation that stops older conversations being starved of polling.
 *
 * Descriptions below are copied verbatim from live WATI getMessages responses.
 */
import { describe, expect, it } from "vitest";
import {
  deriveWatiChatState,
  isWatiSessionExpired,
  parseWatiTicketEvent,
  parseWatiTicketWebhook,
  resolveWatiChatStatus,
} from "@/lib/whatsapp/wati-chat-status.shared";
import { selectInboxSyncBatch } from "@/lib/whatsapp/wati-inbox-sync.server";

describe("parseWatiTicketEvent", () => {
  it("reads the 24h expiry event", () => {
    const event = parseWatiTicketEvent({
      eventType: "ticket",
      type: 4,
      eventDescription: "The chat has been expired (after 24 hours of last received message)",
      created: "2026-08-12T15:20:14.949Z",
    });

    expect(event?.status).toBe("expired");
    expect(event?.at).toBe("2026-08-12T15:20:14.949Z");
  });

  it("reads the assigned operator out of a status change", () => {
    const event = parseWatiTicketEvent({
      eventType: "ticket",
      type: 1,
      eventDescription: "The ticket status has been set as Open by agent Bot",
      topicName: "General Enquiry",
      created: "2026-08-11T18:52:00.000Z",
    });

    expect(event?.status).toBe("open");
    expect(event?.agentName).toBe("Bot");
    expect(event?.topicName).toBe("General Enquiry");
  });

  it("treats a contact-initiated chat as open", () => {
    const event = parseWatiTicketEvent({
      eventType: "ticket",
      type: 0,
      eventDescription: "The chat has been initialized by contact Mchele (393386127524)",
      created: "2026-08-11T18:26:00.000Z",
    });

    expect(event?.status).toBe("open");
    expect(event?.agentName).toBeNull();
  });

  it("recognises a resolution", () => {
    expect(
      parseWatiTicketEvent({
        eventType: "ticket",
        eventDescription: "The ticket status has been set as Solved by agent Khisha",
        created: "2026-08-11T19:00:00.000Z",
      })?.status,
    ).toBe("solved");
  });

  it("ignores message rows so it can never consume a reply", () => {
    expect(parseWatiTicketEvent({ eventType: "message", text: "Sold", owner: false })).toBeNull();
    expect(parseWatiTicketEvent({ eventType: "broadcastMessage", text: "Hello" })).toBeNull();
  });

  it("ignores ticket events it cannot classify", () => {
    expect(
      parseWatiTicketEvent({ eventType: "ticket", eventDescription: "Something unknown happened" }),
    ).toBeNull();
  });
});

describe("deriveWatiChatState", () => {
  it("takes the newest status but keeps the agent named by an earlier event", () => {
    const state = deriveWatiChatState([
      {
        eventType: "ticket",
        eventDescription: "The ticket status has been set as Open by agent Bot",
        topicName: "General Enquiry",
        created: "2026-08-11T18:52:00.000Z",
      },
      { eventType: "message", text: "Sold", owner: false, created: "2026-08-11T18:53:00.000Z" },
      {
        eventType: "ticket",
        eventDescription: "The chat has been expired (after 24 hours of last received message)",
        created: "2026-08-12T15:20:14.949Z",
      },
    ]);

    expect(state.status).toBe("expired");
    expect(state.agentName).toBe("Bot");
    expect(state.topicName).toBe("General Enquiry");
    expect(state.statusAt).toBe("2026-08-12T15:20:14.949Z");
  });

  it("is order-independent — WATI returns newest-first", () => {
    const rows = [
      {
        eventType: "ticket",
        eventDescription: "The chat has been expired (after 24 hours of last received message)",
        created: "2026-08-12T15:20:14.949Z",
      },
      {
        eventType: "ticket",
        eventDescription: "The chat has been initialized by contact Valeriya (100000000)",
        created: "2026-08-11T18:26:00.000Z",
      },
    ];

    expect(deriveWatiChatState(rows).status).toBe("expired");
    expect(deriveWatiChatState([...rows].reverse()).status).toBe("expired");
  });

  it("returns an empty state when a conversation has no ticket events", () => {
    expect(deriveWatiChatState([{ eventType: "message", text: "hi" }])).toEqual({
      status: null,
      agentName: null,
      topicName: null,
      statusAt: null,
    });
  });
});

describe("parseWatiTicketWebhook", () => {
  it("classifies on the description when the event name is not 'ticket'", () => {
    expect(
      parseWatiTicketWebhook({
        eventType: "ticketStatusChanged",
        eventDescription: "The ticket status has been set as Solved by agent Khisha",
        waId: "971500000000",
      })?.status,
    ).toBe("solved");
  });

  it("ignores payloads with no description, so message webhooks fall through", () => {
    expect(parseWatiTicketWebhook({ eventType: "message", text: "Sold" })).toBeNull();
  });
});

describe("isWatiSessionExpired", () => {
  const now = Date.parse("2026-08-13T12:00:00.000Z");

  it("is open inside the 24h window", () => {
    expect(isWatiSessionExpired("2026-08-13T02:00:00.000Z", now)).toBe(false);
  });

  it("is expired past the 24h window", () => {
    expect(isWatiSessionExpired("2026-08-11T02:00:00.000Z", now)).toBe(true);
  });

  it("never expires a chat that has no inbound message at all", () => {
    expect(isWatiSessionExpired(null, now)).toBe(false);
  });
});

describe("resolveWatiChatStatus", () => {
  const now = Date.parse("2026-08-13T12:00:00.000Z");

  it("expires a stale 'open' without waiting for WATI's own event", () => {
    expect(
      resolveWatiChatStatus({
        watiChatStatus: "open",
        lastInboundAt: "2026-08-11T02:00:00.000Z",
        now,
      }),
    ).toBe("expired");
  });

  it("keeps an operator's resolution rather than showing it as expired", () => {
    expect(
      resolveWatiChatStatus({
        watiChatStatus: "solved",
        lastInboundAt: "2026-08-11T02:00:00.000Z",
        now,
      }),
    ).toBe("solved");
  });

  it("leaves a fresh chat on its stored status", () => {
    expect(
      resolveWatiChatStatus({
        watiChatStatus: "open",
        lastInboundAt: "2026-08-13T10:00:00.000Z",
        now,
      }),
    ).toBe("open");
  });

  it("has no status to show before the first sync", () => {
    expect(resolveWatiChatStatus({ watiChatStatus: null, lastInboundAt: null, now })).toBeNull();
  });
});

describe("selectInboxSyncBatch", () => {
  const phones = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => `${prefix}${i}`);

  it("always refreshes threads that already have replies", () => {
    const { phones: batch } = selectInboxSyncBatch(
      { priority: phones("reply", 5), rotating: phones("cold", 200) },
      0,
    );
    for (const p of phones("reply", 5)) expect(batch).toContain(p);
  });

  it("covers every chat across successive passes instead of restarting at the newest", () => {
    const plan = { priority: [] as string[], rotating: phones("cold", 289) };
    const seen = new Set<string>();
    let cursor = 0;

    for (let pass = 0; pass < 10; pass++) {
      const result = selectInboxSyncBatch(plan, cursor);
      for (const p of result.phones) seen.add(p);
      cursor = result.nextCursor;
    }

    expect(seen.size).toBe(289);
  });

  it("does not repeat a phone within a single pass", () => {
    const { phones: batch } = selectInboxSyncBatch(
      { priority: phones("reply", 3), rotating: phones("cold", 4) },
      0,
    );
    expect(new Set(batch).size).toBe(batch.length);
  });

  it("handles a workspace with fewer chats than the per-pass budget", () => {
    const plan = { priority: phones("reply", 2), rotating: phones("cold", 3) };
    const first = selectInboxSyncBatch(plan, 0);
    expect(first.phones).toHaveLength(5);

    const second = selectInboxSyncBatch(plan, first.nextCursor);
    expect(new Set(second.phones)).toEqual(new Set(first.phones));
  });

  it("copes with no rotating phones at all", () => {
    const result = selectInboxSyncBatch({ priority: ["a"], rotating: [] }, 7);
    expect(result.phones).toEqual(["a"]);
    expect(result.nextCursor).toBe(7);
  });
});
