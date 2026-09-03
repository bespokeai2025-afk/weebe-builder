import { describe, expect, it } from "vitest";
import {
  autoDetectCsvColumnMapping,
  mapCsvRowsToLeads,
} from "@/lib/whatsapp/csv-leads.shared";
import {
  formatCampaignRequirement,
  isWhatsappFreeTextAllowed,
  belongsOnListingBoard,
  parseCampaignIntent,
  qualificationFromImportMeta,
  threadMatchesInboxQueue,
  whatsappPersonalLink,
} from "@/lib/whatsapp/campaign-leads.shared";

describe("campaign CSV mapping", () => {
  it("maps JVC owner columns plus requirement, prices, and tags", () => {
    const headers = [
      "Owner Name",
      "Mobile 1",
      "Project",
      "BuildingName 2",
      "UnitNumber",
      "Requirement",
      "Asking Price",
      "Rental Price",
      "Tags",
    ];
    const mapping = autoDetectCsvColumnMapping(headers);
    expect(mapping?.phone).toBe("Mobile 1");
    expect(mapping?.full_name).toBe("Owner Name");
    expect(mapping?.requirement).toBe("Requirement");
    expect(mapping?.asking_price).toBe("Asking Price");
    expect(mapping?.rental_price).toBe("Rental Price");
    expect(mapping?.tags).toBe("Tags");

    const leads = mapCsvRowsToLeads(
      [
        {
          "Owner Name": "Sara Khan",
          "Mobile 1": "971501234567",
          Project: "Samana Manhattan 2",
          "BuildingName 2": "Tower A",
          UnitNumber: "1204",
          Requirement: "Both",
          "Asking Price": "AED 1.85M",
          "Rental Price": "AED 90,000",
          Tags: "hot, jvc",
        },
      ],
      mapping!,
    );

    expect(leads).toHaveLength(1);
    expect(leads[0]!.full_name).toBe("Sara Khan");
    expect(leads[0]!.tags).toEqual(["hot", "jvc"]);
    expect(leads[0]!.qualification?.intent).toBe("both");
    expect(leads[0]!.qualification?.asking_price).toBe("AED 1.85M");
    expect(leads[0]!.import_meta?.Requirement).toBe("Both");
    expect(leads[0]!.import_meta?.Building).toBe("Tower A");
  });

  it("summarises property and requirement for the contacts table", async () => {
    const { getContactPropertySummary, getContactRequirementLabel, groupContactDetailFields } =
      await import("@/lib/whatsapp/csv-leads.shared");
    const contact = {
      name: "Sara Khan",
      phone: "+971501234567",
      notes: null,
      import_meta: {
        "Master Project": "JVC",
        Project: "Samana Manhattan 2",
        Building: "Tower A",
        UnitNumber: "1204",
        "Property Type": "Apartments",
        Requirement: "Both",
        "Asking Price": "AED 1.85M",
        "Rental Price": "AED 90,000",
      },
    };
    expect(getContactPropertySummary(contact)).toContain("Samana Manhattan 2");
    expect(getContactPropertySummary(contact)).toContain("Tower A");
    expect(getContactRequirementLabel(contact)).toBe("Both · Sell AED 1.85M · Rent AED 90,000");
    expect(groupContactDetailFields(contact).map((g) => g.title)).toEqual([
      "Owner",
      "Property",
      "Requirement",
    ]);
  });

  it("does not duplicate dedicated columns in notes", () => {
    const mapping = autoDetectCsvColumnMapping(["Owner Name", "Mobile 1", "Requirement"]);
    const leads = mapCsvRowsToLeads(
      [{ "Owner Name": "Ali", "Mobile 1": "971509998887", Requirement: "Sell" }],
      mapping!,
    );
    const notes = leads[0]!.notes ?? "";
    expect(notes.match(/Requirement/g)?.length).toBe(1);
  });
});

describe("campaign qualification helpers", () => {
  it("parses sell / rent / both", () => {
    expect(parseCampaignIntent("sell")).toBe("sell");
    expect(parseCampaignIntent("to rent")).toBe("rent");
    expect(parseCampaignIntent("sell and rent")).toBe("both");
  });

  it("formats requirement for the leads table", () => {
    expect(
      formatCampaignRequirement({
        intent: "both",
        asking_price: "1.2M",
        rental_price: "80k",
        availability: "",
        property_status: "",
        viewing_availability: "",
        notes: "",
      }),
    ).toBe("Both · Sell 1.2M · Rent 80k");
  });

  it("seeds qualification from CSV meta", () => {
    const q = qualificationFromImportMeta({
      Requirement: "Rent",
      "Rental Price": "AED 75,000",
    });
    expect(q.intent).toBe("rent");
    expect(q.rental_price).toBe("AED 75,000");
  });
});

describe("inbox queue + 24h session", () => {
  it("blocks free-text when the client has never written", () => {
    expect(isWhatsappFreeTextAllowed(null)).toBe(false);
  });

  it("allows free-text within 24h of last inbound", () => {
    const now = Date.parse("2026-08-28T10:00:00.000Z");
    expect(isWhatsappFreeTextAllowed("2026-08-28T09:00:00.000Z", now)).toBe(true);
    expect(isWhatsappFreeTextAllowed("2026-08-26T09:00:00.000Z", now)).toBe(false);
  });

  it("filters Needs reply / Waiting / Closed", () => {
    expect(
      threadMatchesInboxQueue({ lastDirection: "inbound", status: "open" }, "needs_reply"),
    ).toBe(true);
    expect(
      threadMatchesInboxQueue(
        { lastDirection: "outbound", status: "open", expired: false },
        "waiting",
      ),
    ).toBe(true);
    expect(
      threadMatchesInboxQueue(
        { lastDirection: "outbound", status: "open", expired: true },
        "waiting",
      ),
    ).toBe(false);
    expect(threadMatchesInboxQueue({ status: "solved" }, "closed")).toBe(true);
    expect(
      threadMatchesInboxQueue(
        { lastDirection: "outbound", status: "open", expired: true },
        "expired",
      ),
    ).toBe(true);
    expect(
      threadMatchesInboxQueue({ status: "solved", expired: true }, "expired"),
    ).toBe(false);
  });

  it("Inbox stays empty until a reply, then drops the chat after a remark", () => {
    const replied = {
      lastInboundAt: "2026-08-28T09:00:00.000Z",
      lastDirection: "inbound",
      status: "open",
    };
    const unrepliedSend = {
      lastInboundAt: null,
      lastDirection: "outbound",
      status: "open",
    };
    const remarked = { ...replied, listingOutcome: "interested" };
    const expired = { ...replied, expired: true };
    const closed = { ...replied, status: "solved" };

    expect(threadMatchesInboxQueue(unrepliedSend, "working")).toBe(false);
    expect(threadMatchesInboxQueue(replied, "working")).toBe(true);
    expect(threadMatchesInboxQueue(remarked, "working")).toBe(false);
    expect(threadMatchesInboxQueue(expired, "working")).toBe(false);
    expect(threadMatchesInboxQueue(closed, "working")).toBe(false);
    expect(threadMatchesInboxQueue(unrepliedSend, "all")).toBe(true);
    expect(threadMatchesInboxQueue(remarked, "all")).toBe(true);
    expect(threadMatchesInboxQueue(expired, "all")).toBe(true);
    expect(threadMatchesInboxQueue(closed, "all")).toBe(true);
  });

  it("Listing hides expired, closed, and unmarked chats without remark chips", () => {
    const now = Date.parse("2026-08-28T10:00:00.000Z");
    expect(
      belongsOnListingBoard(
        { listing_outcome: "interested", last_reply_at: "2026-08-28T09:00:00.000Z" },
        now,
      ),
    ).toBe(true);
    expect(
      belongsOnListingBoard(
        { listing_outcome: "interested", last_reply_at: "2026-08-26T09:00:00.000Z" },
        now,
      ),
    ).toBe(false);
    expect(
      belongsOnListingBoard(
        { listing_outcome: "lost", last_reply_at: "2026-08-28T09:00:00.000Z" },
        now,
      ),
    ).toBe(false);
    expect(belongsOnListingBoard({ listing_outcome: null, last_reply_at: "2026-08-28T09:00:00.000Z" }, now)).toBe(
      false,
    );
  });

  it("builds a personal WhatsApp link from a stored phone", () => {
    expect(whatsappPersonalLink("+971 50 123 4567")).toBe("https://wa.me/971501234567");
    expect(whatsappPersonalLink("")).toBeNull();
  });
});
