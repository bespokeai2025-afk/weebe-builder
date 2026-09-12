import { describe, expect, it } from "vitest";
import {
  whatsappPersonalLink,
  defaultWhatsappReengagementMessage,
  whatsappWindowRemainingMs,
  whatsappWindowUrgency,
  formatWhatsappWindowRemaining,
  WHATSAPP_WINDOW_MS,
  readCampaignFollowUp,
  writeCampaignFollowUp,
  isCampaignFollowUpOverdue,
  isCampaignFollowUpDueSoon,
  EMPTY_CAMPAIGN_FOLLOW_UP,
} from "@/lib/whatsapp/campaign-leads.shared";

describe("whatsappPersonalLink with pre-filled message", () => {
  it("returns a bare wa.me link when no message is given", () => {
    expect(whatsappPersonalLink("+971501234567")).toBe("https://wa.me/971501234567");
  });

  it("appends an encoded ?text= param when a message is given", () => {
    const link = whatsappPersonalLink("+971501234567", "Hey Bilel, following up!");
    expect(link).toBe("https://wa.me/971501234567?text=Hey%20Bilel%2C%20following%20up!");
  });

  it("returns null for a phone too short to be real", () => {
    expect(whatsappPersonalLink("123", "hello")).toBeNull();
  });

  it("ignores a blank/whitespace-only message", () => {
    expect(whatsappPersonalLink("+971501234567", "   ")).toBe("https://wa.me/971501234567");
  });
});

describe("defaultWhatsappReengagementMessage", () => {
  it("mentions the property when known", () => {
    const msg = defaultWhatsappReengagementMessage({
      contactName: "Bilel",
      property: "a studio in Oro 24",
      campaignName: "JVC Owners",
    });
    expect(msg).toContain("Bilel");
    expect(msg).toContain("a studio in Oro 24");
  });

  it("falls back to campaign name when property is unknown", () => {
    const msg = defaultWhatsappReengagementMessage({ contactName: "Bilel", campaignName: "JVC Owners" });
    expect(msg).toContain("JVC Owners");
  });

  it("still produces a sensible message with no context at all", () => {
    const msg = defaultWhatsappReengagementMessage({});
    expect(msg).toContain("there");
    expect(msg.length).toBeGreaterThan(10);
  });
});

describe("whatsappWindowRemainingMs / urgency / formatting", () => {
  const now = Date.parse("2026-09-10T12:00:00.000Z");

  it("returns null when there's no inbound message yet", () => {
    expect(whatsappWindowRemainingMs(null, now)).toBeNull();
    expect(whatsappWindowUrgency(null)).toBe("none");
  });

  it("is 'safe' with more than 4 hours left", () => {
    const lastInbound = new Date(now - 2 * 60 * 60 * 1000).toISOString(); // 2h ago → 22h left
    const remaining = whatsappWindowRemainingMs(lastInbound, now);
    expect(whatsappWindowUrgency(remaining)).toBe("safe");
    expect(formatWhatsappWindowRemaining(remaining)).toBe("22h 0m left");
  });

  it("is 'warning' inside the 4-hour band", () => {
    const lastInbound = new Date(now - 21 * 60 * 60 * 1000).toISOString(); // 21h ago → 3h left
    const remaining = whatsappWindowRemainingMs(lastInbound, now);
    expect(whatsappWindowUrgency(remaining)).toBe("warning");
  });

  it("is 'critical' inside the final hour", () => {
    const lastInbound = new Date(now - 23.5 * 60 * 60 * 1000).toISOString(); // 30m left
    const remaining = whatsappWindowRemainingMs(lastInbound, now);
    expect(whatsappWindowUrgency(remaining)).toBe("critical");
    expect(formatWhatsappWindowRemaining(remaining)).toBe("30m left");
  });

  it("is 'closed' once the window has passed, with a clear label", () => {
    const lastInbound = new Date(now - 25 * 60 * 60 * 1000).toISOString(); // 1h over
    const remaining = whatsappWindowRemainingMs(lastInbound, now);
    expect(whatsappWindowUrgency(remaining)).toBe("closed");
    expect(formatWhatsappWindowRemaining(remaining)).toBe("Window closed");
  });

  it("WHATSAPP_WINDOW_MS matches 24 hours exactly", () => {
    expect(WHATSAPP_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("campaign follow-up date read/write", () => {
  it("round-trips through meta without disturbing other keys", () => {
    const meta = { keep: "me" };
    const followUp = { date: "2026-09-15", nextAction: "Call about the offer" };
    const written = writeCampaignFollowUp(meta, followUp);
    expect(written.keep).toBe("me");
    expect(readCampaignFollowUp(written)).toEqual(followUp);
  });

  it("defaults to empty when meta has none", () => {
    expect(readCampaignFollowUp(null)).toEqual(EMPTY_CAMPAIGN_FOLLOW_UP);
    expect(readCampaignFollowUp({})).toEqual(EMPTY_CAMPAIGN_FOLLOW_UP);
  });

  it("ignores a malformed date field rather than throwing", () => {
    const read = readCampaignFollowUp({ follow_up: { date: 12345, nextAction: "x" } });
    expect(read.date).toBeNull();
  });
});

describe("follow-up overdue / due-soon", () => {
  const now = Date.parse("2026-09-10T12:00:00.000Z");

  it("is overdue when the date is in the past", () => {
    const followUp = { date: "2026-09-09T12:00:00.000Z", nextAction: "Call" };
    expect(isCampaignFollowUpOverdue(followUp, now)).toBe(true);
    expect(isCampaignFollowUpDueSoon(followUp, now)).toBe(false);
  });

  it("is due-soon within the next 24h but not yet overdue", () => {
    const followUp = { date: "2026-09-11T06:00:00.000Z", nextAction: "Call" };
    expect(isCampaignFollowUpOverdue(followUp, now)).toBe(false);
    expect(isCampaignFollowUpDueSoon(followUp, now)).toBe(true);
  });

  it("is neither overdue nor due-soon when far in the future", () => {
    const followUp = { date: "2026-09-20T12:00:00.000Z", nextAction: "Call" };
    expect(isCampaignFollowUpOverdue(followUp, now)).toBe(false);
    expect(isCampaignFollowUpDueSoon(followUp, now)).toBe(false);
  });

  it("is neither when there's no date set", () => {
    expect(isCampaignFollowUpOverdue(EMPTY_CAMPAIGN_FOLLOW_UP, now)).toBe(false);
    expect(isCampaignFollowUpDueSoon(EMPTY_CAMPAIGN_FOLLOW_UP, now)).toBe(false);
  });
});
