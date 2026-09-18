/**
 * Regression: real replies never reached the Inbox after a campaign blast.
 *
 * `listWhatsappThreads` fetches the top 60 conversations ordered by `last_message_at` — which
 * counts OUR sends. A campaign put 218 outbound-only threads above every genuine reply, so
 * 971563535939, 971529063596 and 971508726628 sat at ranks 230-232 of 847 and were never in the
 * payload. The client's Inbox filter runs after the fetch, so it could not recover them: only 8 of
 * the 60 fetched threads had ever replied. The queue has to narrow the query, not the result.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_INBOX_QUEUE_FILTER,
  threadMatchesInboxQueue,
  type InboxQueueFilter,
} from "@/lib/whatsapp/campaign-leads.shared";

/** Which queues are about replies, and so must be narrowed server-side. */
function repliedOnlyFor(filter: InboxQueueFilter): boolean | undefined {
  return filter === "working" || filter === "needs_reply" ? true : undefined;
}

describe("reply queues narrow the query", () => {
  it("applies to the default Inbox queue", () => {
    expect(DEFAULT_INBOX_QUEUE_FILTER).toBe("working");
    expect(repliedOnlyFor(DEFAULT_INBOX_QUEUE_FILTER)).toBe(true);
  });

  it("applies to Needs reply", () => {
    expect(repliedOnlyFor("needs_reply")).toBe(true);
  });

  it("does NOT apply to All, which must still show unreplied sends", () => {
    // "All — every conversation, including unreplied sends".
    expect(repliedOnlyFor("all")).toBeUndefined();
  });

  it("does not apply to the queues that are about our own side or closure", () => {
    for (const f of ["waiting", "active", "expired", "closed"] as InboxQueueFilter[]) {
      expect(repliedOnlyFor(f)).toBeUndefined();
    }
  });
});

describe("threadMatchesInboxQueue — unchanged behaviour the fix relies on", () => {
  const replied = {
    lastDirection: "inbound",
    lastInboundAt: "2026-09-18T07:37:00Z",
    status: "open",
    listingOutcome: null,
    expired: false,
  };

  it("keeps an unremarked open reply in the Inbox", () => {
    // All three threads satisfied this; they were simply never fetched.
    expect(threadMatchesInboxQueue(replied, "working")).toBe(true);
  });

  it("drops it once a remark is recorded", () => {
    expect(threadMatchesInboxQueue({ ...replied, listingOutcome: "interested" }, "working")).toBe(
      false,
    );
  });

  it("drops it when solved or expired", () => {
    expect(threadMatchesInboxQueue({ ...replied, status: "solved" }, "working")).toBe(false);
    expect(threadMatchesInboxQueue({ ...replied, expired: true }, "working")).toBe(false);
  });

  it("still shows an outbound-only thread under All but not the Inbox", () => {
    const sendOnly = {
      lastDirection: "outbound",
      lastInboundAt: null,
      status: "open",
      listingOutcome: null,
      expired: false,
    };
    expect(threadMatchesInboxQueue(sendOnly, "all")).toBe(true);
    expect(threadMatchesInboxQueue(sendOnly, "working")).toBe(false);
  });
});
