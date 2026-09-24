/**
 * The inbox highlight must mean "unread", not "unreplied".
 *
 * `sync_whatsapp_conversation()` recomputes unread_count as the number of inbound messages since
 * the last OUTBOUND one, and its trigger re-runs on every message insert — so it kept overwriting
 * the zero written when an agent opened the thread. A conversation that had been read and
 * deliberately left unanswered stayed highlighted forever. 14 threads in Avenue Elite were in that
 * state.
 *
 * These pin the shared rule both the inbox and Listing Leads derive their indicator from.
 */
import { describe, expect, it } from "vitest";
import {
  hasNewInboundReply,
  isWhatsappThreadSeen,
} from "@/lib/whatsapp/campaign-leads.shared";

const READ_AT = "2026-09-23T07:15:21.000Z";
const BEFORE = "2026-09-22T07:18:52.000Z";
const AFTER = "2026-09-23T09:00:00.000Z";

describe("isWhatsappThreadSeen", () => {
  it("is seen once read at or after the newest message", () => {
    expect(isWhatsappThreadSeen(READ_AT, BEFORE)).toBe(true);
    expect(isWhatsappThreadSeen(READ_AT, READ_AT)).toBe(true);
  });

  it("is unseen again when a newer message arrives", () => {
    expect(isWhatsappThreadSeen(READ_AT, AFTER)).toBe(false);
  });

  it("is unseen when never read", () => {
    expect(isWhatsappThreadSeen(null, BEFORE)).toBe(false);
  });

  it("does not treat an unparseable timestamp as read", () => {
    expect(isWhatsappThreadSeen("not a date", BEFORE)).toBe(false);
  });
});

describe("hasNewInboundReply", () => {
  /** The exact shape of the threads that stayed highlighted. */
  it("clears once read, even though nobody replied", () => {
    expect(
      hasNewInboundReply({
        lastDirection: "inbound",
        lastReadAt: READ_AT,
        lastInboundAt: BEFORE,
        // Stale stored counter — the DB counts "unreplied", so this stays above zero.
        unreadCount: 1,
      }),
    ).toBe(false);
  });

  it("still flags a genuinely new reply", () => {
    expect(
      hasNewInboundReply({
        lastDirection: "inbound",
        lastReadAt: READ_AT,
        lastInboundAt: AFTER,
        unreadCount: 1,
      }),
    ).toBe(true);
  });

  it("falls back to the stored counter only when the thread was never read", () => {
    expect(
      hasNewInboundReply({
        lastDirection: "inbound",
        lastReadAt: null,
        lastInboundAt: BEFORE,
        unreadCount: 2,
      }),
    ).toBe(true);
    expect(
      hasNewInboundReply({
        lastDirection: "inbound",
        lastReadAt: null,
        lastInboundAt: BEFORE,
        unreadCount: 0,
      }),
    ).toBe(false);
  });

  it("never flags a thread where we spoke last", () => {
    expect(
      hasNewInboundReply({
        lastDirection: "outbound",
        lastReadAt: null,
        lastInboundAt: BEFORE,
        unreadCount: 5,
      }),
    ).toBe(false);
  });

  it("never flags a thread with no inbound message at all", () => {
    expect(
      hasNewInboundReply({
        lastDirection: "inbound",
        lastReadAt: null,
        lastInboundAt: null,
        unreadCount: 3,
      }),
    ).toBe(false);
  });
});
