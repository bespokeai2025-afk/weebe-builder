import { describe, expect, it } from "vitest";
import {
  belongsOnSalesPipeline,
  isListingSlaBreached,
  listingOutcomePromotesToSalesPipeline,
  listingOutcomeToCampaignStage,
  nextRoundRobinAssignee,
  readListingStage,
  writeListingOutcome,
  writeListingStage,
} from "@/lib/whatsapp/campaign-leads.shared";

describe("listing CRM outcomes and pipeline gate", () => {
  it("maps Converted to the listing converted stage and sales pipeline", () => {
    expect(listingOutcomeToCampaignStage("converted")).toBe("converted");
    expect(listingOutcomePromotesToSalesPipeline("converted")).toBe(true);
    expect(listingOutcomePromotesToSalesPipeline("interested")).toBe(false);
  });

  it("keeps campaign working stages off sales pipeline", () => {
    expect(
      belongsOnSalesPipeline({
        pipeline_stage: "new_response",
        meta: {},
      }),
    ).toBe(false);
    expect(
      belongsOnSalesPipeline({
        pipeline_stage: "lead",
        meta: writeListingStage({}, "engaged"),
      }),
    ).toBe(false);
    expect(
      belongsOnSalesPipeline({
        pipeline_stage: "sale_done",
        meta: writeListingStage({}, "converted"),
      }),
    ).toBe(true);
    expect(
      belongsOnSalesPipeline({
        pipeline_stage: "qualified",
        meta: {},
      }),
    ).toBe(true);
  });

  it("reads listing_stage from meta with pipeline fallback", () => {
    expect(readListingStage({ listing_stage: "assigned" }, "lead")).toBe("assigned");
    expect(readListingStage({}, "new_response")).toBe("new_response");
    expect(readListingStage({}, "qualified")).toBeNull();
  });

  it("writes outcome onto meta and listing stage", () => {
    const meta = writeListingOutcome({}, { status: "interested", at: "2026-08-31T00:00:00Z" });
    expect(meta.listing_stage).toBe("engaged");
    expect((meta.listing_outcome as { status: string }).status).toBe("interested");
  });

  it("breaches SLA after 24h with no agent contact", () => {
    const assignedAt = "2026-08-30T00:00:00Z";
    const now = Date.parse("2026-08-31T01:00:00Z");
    expect(
      isListingSlaBreached(
        {
          assigned_to: "agent-1",
          assigned_at: assignedAt,
          last_contacted_at: null,
          meta: writeListingStage({}, "assigned"),
        },
        now,
      ),
    ).toBe(true);
    expect(
      isListingSlaBreached(
        {
          assigned_to: "agent-1",
          assigned_at: assignedAt,
          last_contacted_at: "2026-08-30T12:00:00Z",
          meta: writeListingStage({}, "assigned"),
        },
        now,
      ),
    ).toBe(false);
  });

  it("round-robins to the next agent", () => {
    expect(nextRoundRobinAssignee(["a", "b", "c"], "a")).toBe("b");
    expect(nextRoundRobinAssignee(["a", "b", "c"], "c")).toBe("a");
    expect(nextRoundRobinAssignee(["a"], "a")).toBeNull();
  });
});
