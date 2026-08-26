import { describe, expect, it } from "vitest";
import {
  buildWhatsappThreadFromMessages,
  sortWhatsappInboxThreads,
  threadNeedsReply,
} from "@/lib/whatsapp/wa-inbox-threads.shared";
import { enrichInboxThreadsWithLeadIds } from "@/lib/dashboard/whatsapp.functions";

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

  it("keeps the canonical CRM lead linked to a thread", () => {
    const t = buildWhatsappThreadFromMessages("971500000000", [
      {
        body: "Yes interested",
        sent_at: "2026-08-11T11:00:00Z",
        direction: "inbound",
        lead_id: "7c30d1f3-29f2-4d8a-8a76-2a4a1ca70d66",
      },
    ]);

    expect(t?.leadId).toBe("7c30d1f3-29f2-4d8a-8a76-2a4a1ca70d66");
  });

  it("links message-only fallback threads by conversation ID, then formatted phone", async () => {
    const conversationLeadId = "7c30d1f3-29f2-4d8a-8a76-2a4a1ca70d66";
    const phoneLeadId = "d9ee74ac-12bd-4571-bd7b-581601a1a8d0";
    const threads = [
      { phone: "+447700900123", leadId: null },
      { phone: "+447700900456", leadId: null },
    ];
    const sb = {
      from: () => ({
        select: (columns: string) => ({
          eq: () =>
            columns === "id, buzzchat_conversation_id"
              ? {
                  in: async () => ({
                    data: [{ id: conversationLeadId, buzzchat_conversation_id: "buzzchat-123" }],
                  }),
                }
              : {
                  eq: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: null }),
                    }),
                  }),
                  ilike: () => ({
                    limit: async () => ({
                      data: [{ id: phoneLeadId, full_name: null, phone: "+44 7700 900 456" }],
                    }),
                  }),
                },
        }),
      }),
    };

    await enrichInboxThreadsWithLeadIds(
      sb,
      "workspace-id",
      threads,
      new Map([["447700900123", "buzzchat-123"]]),
    );

    expect(threads[0]?.leadId).toBe(conversationLeadId);
    expect(threads[1]?.leadId).toBe(phoneLeadId);
  });
});
