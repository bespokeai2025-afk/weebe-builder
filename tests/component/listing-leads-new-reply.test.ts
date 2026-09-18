/**
 * Regression: the "new reply" tag showed on every lead in Listing Leads, including ones already
 * answered — 57 of 64 threads in Avenue Elite were tagged.
 *
 * Two compounding causes. The rule compared `last_read_at` against `last_message_at`, which is the
 * newest message in EITHER direction, so sending a reply immediately made the thread look unread
 * again. And WATI's `unread_count` was OR'd in, so once it was stale the tag could never be
 * cleared locally. The inbox already required `last_direction === "inbound"`; Listing Leads only
 * checked that an inbound had ever existed.
 */
import { describe, expect, it } from "vitest";
import { hasNewInboundReply, isWhatsappThreadSeen } from "@/lib/whatsapp/campaign-leads.shared";

const T = {
  theirFirst: "2026-09-18T07:00:00.000Z",
  weRead: "2026-09-18T07:01:00.000Z",
  weReplied: "2026-09-18T07:02:00.000Z",
  theirSecond: "2026-09-18T07:03:00.000Z",
};

describe("hasNewInboundReply", () => {
  it("does not tag a thread we replied to", () => {
    // The exact shape of all 29 replied threads that were wrongly tagged.
    expect(
      hasNewInboundReply({
        lastDirection: "outbound",
        lastReadAt: T.weRead,
        lastInboundAt: T.theirFirst,
        unreadCount: 0,
      }),
    ).toBe(false);
  });

  it("does not tag a replied thread even when WATI's counter is stale", () => {
    expect(
      hasNewInboundReply({
        lastDirection: "outbound",
        lastReadAt: T.weRead,
        lastInboundAt: T.theirFirst,
        unreadCount: 3,
      }),
    ).toBe(false);
  });

  it("does not tag a thread we have read, even without replying", () => {
    // Reading clears it; replying is deliberately not required.
    expect(
      hasNewInboundReply({
        lastDirection: "inbound",
        lastReadAt: T.weRead,
        lastInboundAt: T.theirFirst,
        unreadCount: 0,
      }),
    ).toBe(false);
  });

  it("does not let a stale unread_count override a local read", () => {
    // This kept the tag on permanently: read after their message, counter still set.
    expect(
      hasNewInboundReply({
        lastDirection: "inbound",
        lastReadAt: T.weRead,
        lastInboundAt: T.theirFirst,
        unreadCount: 2,
      }),
    ).toBe(false);
  });

  it("tags a reply that arrived after we last read the thread", () => {
    expect(
      hasNewInboundReply({
        lastDirection: "inbound",
        lastReadAt: T.weRead,
        lastInboundAt: T.theirSecond,
        unreadCount: 1,
      }),
    ).toBe(true);
  });

  it("tags an unanswered thread we have never opened", () => {
    expect(
      hasNewInboundReply({
        lastDirection: "inbound",
        lastReadAt: null,
        lastInboundAt: T.theirFirst,
        unreadCount: 1,
      }),
    ).toBe(true);
  });

  it("tags nothing when the contact has never written", () => {
    expect(
      hasNewInboundReply({
        lastDirection: "outbound",
        lastReadAt: null,
        lastInboundAt: null,
        unreadCount: 0,
      }),
    ).toBe(false);
  });

  it("falls back to WATI's counter only when there is no local read state", () => {
    const base = { lastDirection: "inbound", lastInboundAt: T.theirFirst } as const;
    expect(hasNewInboundReply({ ...base, lastReadAt: null, unreadCount: 0 })).toBe(false);
    expect(hasNewInboundReply({ ...base, lastReadAt: null, unreadCount: 1 })).toBe(true);
  });

  it("is case-insensitive about the stored direction", () => {
    expect(
      hasNewInboundReply({
        lastDirection: "INBOUND",
        lastReadAt: null,
        lastInboundAt: T.theirFirst,
        unreadCount: 1,
      }),
    ).toBe(true);
  });

  it("re-tags after each new reply in a back-and-forth", () => {
    // read -> replied -> they write again: tag must come back.
    expect(
      hasNewInboundReply({
        lastDirection: "inbound",
        lastReadAt: T.weReplied,
        lastInboundAt: T.theirSecond,
        unreadCount: 1,
      }),
    ).toBe(true);
  });
});

describe("isWhatsappThreadSeen (why last_message_at was the wrong input)", () => {
  it("reports unseen when our own later reply is used as the comparison point", () => {
    // The old call passed last_message_at, which is our outbound here — so a
    // thread we had just answered read as unseen.
    expect(isWhatsappThreadSeen(T.weRead, T.weReplied)).toBe(false);
    // Against their message, which is what matters, it is correctly seen.
    expect(isWhatsappThreadSeen(T.weRead, T.theirFirst)).toBe(true);
  });
});
