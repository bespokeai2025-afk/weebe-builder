import { describe, expect, it } from "vitest";
import {
  earlierIso,
  isOurWatiSendLog,
  sameWatiMessageText,
  watiStatusMovesForward,
} from "@/lib/whatsapp/wati-message-match.shared";
import { findDuplicateMessage } from "@/lib/whatsapp/wati-inbox-sync.server";

describe("wati message match", () => {
  it("text matches up to spacing and case, never on empty", () => {
    expect(sameWatiMessageText("Hi Mr.Ms. Long, \nThis is Khisha", "hi mr.ms. long,  this is khisha")).toBe(true);
    expect(sameWatiMessageText("Hi Long, We specialise", "Hi Mr.Ms. Long, I'm reaching out")).toBe(false);
    expect(sameWatiMessageText("", "")).toBe(false);
  });

  it("knows our send logs from imported rows", () => {
    expect(isOurWatiSendLog({ external_id: "lead_x_1a2b3c4d", campaign_id: "c" })).toBe(true);
    expect(isOurWatiSendLog({ external_id: "6ae9dfc90955b5ec072b23ec", campaign_id: null })).toBe(false);
    expect(isOurWatiSendLog({ external_id: "lead_x", whatsapp_message_id: "wamid.x" })).toBe(false);
  });

  it("status only moves forward, or to failed from sent", () => {
    expect(watiStatusMovesForward("sent", "delivered")).toBe(true);
    expect(watiStatusMovesForward("read", "sent")).toBe(false);
    expect(watiStatusMovesForward("sent", "failed")).toBe(true);
    expect(watiStatusMovesForward("read", "failed")).toBe(false);
  });

  it("the earlier time wins", () => {
    expect(earlierIso("2026-11-03T13:23:04Z", "2026-11-03T13:21:13Z")).toBe("2026-11-03T13:21:13Z");
    expect(earlierIso(null, "2026-11-03T13:21:13Z")).toBe("2026-11-03T13:21:13Z");
  });

  it("the live case: our log 111 s after WATI's send, after the reply, still matches", () => {
    const ours = {
      id: "ours",
      external_id: "lead_dda1fbc1-1c30-40ea-8442-9_aa11bb22",
      whatsapp_message_id: null,
      sent_at: "2026-11-03T13:23:04.000Z",
      body: "Hi Mr.Ms. Long, \nThis is Khisha from Avenue 7.\nI'm reaching out regarding your unit at R3 Ruba-V-26.",
      direction: "outbound",
      campaign_id: "camp",
      status: "delivered",
    };
    const wati = {
      contact_phone: "+971564395033",
      body: "Hi Mr.Ms. Long,  This is Khisha from Avenue 7. I'm reaching out regarding your unit at R3 Ruba-V-26.",
      direction: "outbound",
      external_id: "6ae9dfc90955b5ec072b23ec",
      whatsapp_message_id: null,
      sent_at: "2026-11-03T13:21:13.000Z",
      sender_channel: "campaign",
      status: "delivered",
      wati_status: "DELIVERED",
    } as never;
    expect(findDuplicateMessage(wati, [ours])?.id).toBe("ours");
  });
});

describe("healing an old imported copy", () => {
  it("finds our send log for WATI's entry even when the imported copy is stored too", async () => {
    const { findOurSendLogFor } = await import("@/lib/whatsapp/wati-inbox-sync.server");
    const parsed = {
      contact_phone: "+971500006453",
      body: "Hi Mr.Ms. Fahad,  This is Khisha from Avenue 7.",
      direction: "outbound",
      external_id: "6ae9e02cae5997e0815b0f74",
      whatsapp_message_id: null,
      sent_at: "2026-11-03T13:22:52.000Z",
      sender_channel: "campaign",
      status: "sent",
      wati_status: "SENT",
    } as never;
    const importedCopy = { id: "copy", external_id: "6ae9e02cae5997e0815b0f74", campaign_id: null, whatsapp_message_id: null, sent_at: "2026-11-03T13:22:52.000Z", body: "Hi Mr.Ms. Fahad,  This is Khisha from Avenue 7.", direction: "outbound" };
    const ours = { id: "ours", external_id: "lead_8d4bb91a_aa11bb22", campaign_id: "camp", whatsapp_message_id: null, sent_at: "2026-11-03T13:22:52.000Z", body: "Hi Mr.Ms. Fahad, This is Khisha from Avenue 7.", direction: "outbound" };
    expect(findOurSendLogFor(parsed, [importedCopy, ours])?.id).toBe("ours");
    expect(findOurSendLogFor(parsed, [importedCopy])).toBeNull();
  });
});

describe("failure reasons", () => {
  it("tells a detailed reason from a bare status word", async () => {
    const { hasDetailedWatiStatus } = await import("@/lib/whatsapp/wati-message-match.shared");
    expect(hasDetailedWatiStatus("FAILED")).toBe(false);
    expect(hasDetailedWatiStatus("Message undeliverable")).toBe(true);
    expect(hasDetailedWatiStatus(null)).toBe(false);
  });

  it("the sync keeps WATI's failedDetail for a failed message", async () => {
    const { parseWatiV1InboxMessage } = await import("@/lib/whatsapp/wati-inbox-sync.server");
    const row = parseWatiV1InboxMessage(
      {
        id: "6ae9e02e0955b5ec072b2656",
        eventType: "broadcastMessage",
        statusString: "FAILED",
        failedDetail: "Message undeliverable as Meta has restricted it for higher quality messaging - retry again in a few days",
        text: "Hi Mr.Ms. Hosam",
        created: "2026-11-03T13:22:54.441Z",
        owner: true,
      } as never,
      "971500000292",
    );
    expect(row?.wati_status).toMatch(/Meta has restricted it/);
    expect(row?.status).toBe("failed");
  });
});
