import { describe, expect, it } from "vitest";
import {
  areaFromPropertyMeta,
  isArchivedCampaignStatus,
  lastCampaignIdFromMessages,
  mergeWhatsappMessageRows,
  phoneLookupVariants,
  threadMatchesInboxOrg,
} from "@/lib/whatsapp/inbox-campaign-org.shared";

describe("inbox campaign organisation", () => {
  it("treats completed campaigns as archived", () => {
    expect(isArchivedCampaignStatus("completed")).toBe(true);
    expect(isArchivedCampaignStatus("running")).toBe(false);
    expect(isArchivedCampaignStatus("active")).toBe(false);
  });

  it("reads area from Master Location / Project aliases", () => {
    expect(areaFromPropertyMeta({ "Master Location": "Jumeirah Village Circle" })).toBe(
      "Jumeirah Village Circle",
    );
    expect(areaFromPropertyMeta({ masterproject: "Arabian Ranches 3" })).toBe("Arabian Ranches 3");
    expect(areaFromPropertyMeta({})).toBe("");
  });

  it("builds phone lookup variants for lead history", () => {
    expect(phoneLookupVariants("+971501234567")).toEqual(
      expect.arrayContaining(["+971501234567", "971501234567"]),
    );
  });

  it("picks the latest outbound campaign on a thread", () => {
    expect(
      lastCampaignIdFromMessages([
        { campaign_id: "old", direction: "outbound", sent_at: "2026-01-01T00:00:00Z" },
        { campaign_id: "jvc", direction: "outbound", sent_at: "2026-08-01T00:00:00Z" },
        { campaign_id: "jvc", direction: "inbound", sent_at: "2026-08-02T00:00:00Z" },
      ]),
    ).toBe("jvc");
  });

  it("keeps active inbox free of archived campaigns", () => {
    expect(
      threadMatchesInboxOrg(
        { lastCampaignId: "a", campaignArchived: true, area: "JVC" },
        { scope: "active" },
      ),
    ).toBe(false);
    expect(
      threadMatchesInboxOrg(
        { lastCampaignId: "a", campaignArchived: false, area: "JVC" },
        { scope: "active", area: "JVC" },
      ),
    ).toBe(true);
    expect(
      threadMatchesInboxOrg(
        { lastCampaignId: "old", campaignArchived: true, area: "JVC" },
        { scope: "all" },
      ),
    ).toBe(true);
    expect(
      threadMatchesInboxOrg(
        { lastCampaignId: "old", campaignArchived: true, area: "JVC" },
        {},
      ),
    ).toBe(true);
    expect(
      threadMatchesInboxOrg(
        { lastCampaignId: "a", campaignIds: ["a"], campaignArchived: true, area: "Marina" },
        { scope: "archive", campaignId: "a" },
      ),
    ).toBe(true);
    expect(
      threadMatchesInboxOrg(
        {
          lastCampaignId: "later",
          campaignIds: ["a", "later"],
          campaignArchived: false,
          area: "JVC",
        },
        { campaignId: "a" },
      ),
    ).toBe(true);
  });

  it("dedupes lead WhatsApp rows from lead_id and phone queries", () => {
    const merged = mergeWhatsappMessageRows([
      [{ id: "1", body: "Hi", sent_at: "2026-08-01T10:00:00Z" }],
      [
        { id: "1", body: "Hi", sent_at: "2026-08-01T10:00:00Z" },
        { id: "2", body: "Yes", sent_at: "2026-08-01T11:00:00Z" },
      ],
    ]);
    expect(merged.map((m) => m.id)).toEqual(["1", "2"]);
  });
});
