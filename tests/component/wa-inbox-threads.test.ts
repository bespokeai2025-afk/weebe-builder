import { describe, expect, it } from "vitest";
import {
  buildWhatsappThreadFromMessages,
  sortWhatsappInboxThreads,
  threadNeedsReply,
} from "@/lib/whatsapp/wa-inbox-threads.shared";

describe("wa-inbox-threads", () => {
  it("detects when contact replied last", () => {
    expect(threadNeedsReply({ lastDirection: "inbound" })).toBe(true);
    expect(threadNeedsReply({ lastDirection: "outbound" })).toBe(false);
  });

  it("sorts replied threads to the top", () => {
    const sorted = sortWhatsappInboxThreads([
      { phone: "1", lastAt: "2026-08-11T12:00:00Z", lastDirection: "outbound" },
      { phone: "2", lastAt: "2026-08-11T11:00:00Z", lastDirection: "inbound" },
    ]);
    expect(sorted[0]?.phone).toBe("2");
  });

  it("builds thread from messages using latest direction", () => {
    const t = buildWhatsappThreadFromMessages("971500000000", [
      { body: "Hi", sent_at: "2026-08-11T10:00:00Z", direction: "outbound" },
      { body: "Yes interested", sent_at: "2026-08-11T11:00:00Z", direction: "inbound" },
    ]);
    expect(t?.needsReply).toBe(true);
    expect(t?.lastMessage).toBe("Yes interested");
    expect(t?.unread).toBe(1);
  });
});
