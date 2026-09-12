import { describe, expect, it } from "vitest";
import {
  resolveCampaignType,
  isCampaignType,
  outcomesForCampaignType,
  outcomeLabelsForCampaignType,
  isValidOutcomeForCampaignType,
  outcomeLabel,
  campaignOutcomeToStage,
  campaignOutcomeToLeadStatus,
  campaignOutcomePromotesToPipeline,
  isActiveOutcomeForCampaignType,
  readOffPlanQualification,
  writeOffPlanQualification,
  readSecondaryQualification,
  writeSecondaryQualification,
  formatOffPlanRequirement,
  formatSecondaryRequirement,
  readOffPlanCampaignFields,
  readSecondaryCampaignFields,
  readCampaignOutcome,
  writeCampaignOutcome,
  EMPTY_OFF_PLAN_QUALIFICATION,
  EMPTY_SECONDARY_QUALIFICATION,
} from "@/lib/whatsapp/campaign-types.shared";
import {
  LISTING_OUTCOMES,
  readListingStage,
  SIMPLIFIED_LEAD_STAGES,
  CAMPAIGN_LEAD_STAGE_LABELS,
} from "@/lib/whatsapp/campaign-leads.shared";

describe("resolveCampaignType", () => {
  it("defaults unknown/blank/legacy values to listing_acquisition", () => {
    expect(resolveCampaignType(null)).toBe("listing_acquisition");
    expect(resolveCampaignType(undefined)).toBe("listing_acquisition");
    expect(resolveCampaignType("")).toBe("listing_acquisition");
    expect(resolveCampaignType("bogus")).toBe("listing_acquisition");
  });

  it("passes through valid types", () => {
    expect(resolveCampaignType("off_plan")).toBe("off_plan");
    expect(resolveCampaignType("secondary")).toBe("secondary");
    expect(resolveCampaignType("listing_acquisition")).toBe("listing_acquisition");
  });

  it("isCampaignType rejects anything outside the three types", () => {
    expect(isCampaignType("off_plan")).toBe(true);
    expect(isCampaignType("rentals")).toBe(false);
  });
});

describe("outcomesForCampaignType", () => {
  it("listing_acquisition delegates to the existing, unchanged LISTING_OUTCOMES", () => {
    expect(outcomesForCampaignType("listing_acquisition")).toBe(LISTING_OUTCOMES);
  });

  it("off_plan and secondary use the buyer outcome set", () => {
    expect(outcomesForCampaignType("off_plan")).toContain("already_purchased");
    expect(outcomesForCampaignType("secondary")).toContain("already_purchased");
    expect(outcomesForCampaignType("off_plan")).not.toContain("already_sold_rented");
  });
});

describe("isValidOutcomeForCampaignType", () => {
  it("rejects a listing outcome against a buyer campaign", () => {
    expect(isValidOutcomeForCampaignType("off_plan", "already_sold_rented")).toBe(false);
  });

  it("rejects a buyer outcome against a listing campaign", () => {
    expect(isValidOutcomeForCampaignType("listing_acquisition", "already_purchased")).toBe(false);
  });

  it("accepts the matching outcome for each type", () => {
    expect(isValidOutcomeForCampaignType("listing_acquisition", "already_sold_rented")).toBe(true);
    expect(isValidOutcomeForCampaignType("off_plan", "already_purchased")).toBe(true);
    expect(isValidOutcomeForCampaignType("secondary", "already_purchased")).toBe(true);
  });
});

describe("outcomeLabel", () => {
  it("labels off_plan qualified as buyer/investor, secondary as buyer", () => {
    expect(outcomeLabel("off_plan", "qualified")).toMatch(/investor/i);
    expect(outcomeLabel("secondary", "qualified")).toBe("Qualified buyer");
  });
});

describe("campaignOutcomeToStage / status / pipeline promotion", () => {
  it("buyer 'interested' engages, 'not_interested' closes, 'converted' promotes", () => {
    expect(campaignOutcomeToStage("off_plan", "interested")).toBe("engaged");
    expect(campaignOutcomeToStage("off_plan", "not_interested")).toBe("closed");
    expect(campaignOutcomeToStage("off_plan", "converted")).toBe("converted");
    expect(campaignOutcomePromotesToPipeline("off_plan", "converted")).toBe(true);
    expect(campaignOutcomePromotesToPipeline("off_plan", "interested")).toBe(false);
  });

  it("already_purchased closes the record like not_interested (no active opportunity)", () => {
    expect(campaignOutcomeToStage("secondary", "already_purchased")).toBe("closed");
    expect(campaignOutcomeToLeadStatus("secondary", "already_purchased")).toBe("not_interested");
  });

  it("remark keeps the record active (engaged), never closes it", () => {
    expect(campaignOutcomeToStage("off_plan", "remark")).toBe("engaged");
    expect(isActiveOutcomeForCampaignType("off_plan", "remark")).toBe(true);
  });

  it("no_response is a follow-up, not a close, so it can be recycled", () => {
    expect(campaignOutcomeToStage("secondary", "no_response")).toBe("follow_up");
    expect(isActiveOutcomeForCampaignType("secondary", "no_response")).toBe(false);
  });

  it("listing_acquisition dispatch still matches the original listing behavior", () => {
    expect(campaignOutcomeToStage("listing_acquisition", "converted")).toBe("converted");
    expect(campaignOutcomePromotesToPipeline("listing_acquisition", "converted")).toBe(true);
    expect(campaignOutcomePromotesToPipeline("listing_acquisition", "interested")).toBe(false);
  });
});

describe("Off-Plan qualification read/write", () => {
  it("round-trips through meta without disturbing other keys", () => {
    const meta = { some_other_key: "keep me" };
    const q = { ...EMPTY_OFF_PLAN_QUALIFICATION, budget: "AED 2M", developer_project: "Emaar · Beachfront" };
    const written = writeOffPlanQualification(meta, q);
    expect(written.some_other_key).toBe("keep me");
    expect(readOffPlanQualification(written)).toEqual(q);
  });

  it("defaults to empty qualification when meta has none", () => {
    expect(readOffPlanQualification(null)).toEqual(EMPTY_OFF_PLAN_QUALIFICATION);
    expect(readOffPlanQualification({})).toEqual(EMPTY_OFF_PLAN_QUALIFICATION);
  });

  it("does not collide with the Secondary qualification key on the same lead", () => {
    let meta: Record<string, unknown> = {};
    meta = writeOffPlanQualification(meta, { ...EMPTY_OFF_PLAN_QUALIFICATION, budget: "AED 1M" });
    meta = writeSecondaryQualification(meta, { ...EMPTY_SECONDARY_QUALIFICATION, budget: "AED 900k" });
    expect(readOffPlanQualification(meta).budget).toBe("AED 1M");
    expect(readSecondaryQualification(meta).budget).toBe("AED 900k");
  });
});

describe("Secondary qualification read/write", () => {
  it("round-trips through meta", () => {
    const q = { ...EMPTY_SECONDARY_QUALIFICATION, property_type: "Apartment", bedrooms_size: "2BR" };
    const written = writeSecondaryQualification({}, q);
    expect(readSecondaryQualification(written)).toEqual(q);
  });
});

describe("requirement summaries", () => {
  it("formats off-plan requirement from developer/project + unit + budget", () => {
    const q = { ...EMPTY_OFF_PLAN_QUALIFICATION, developer_project: "Emaar", unit_type_size: "1BR 750sqft", budget: "AED 1.5M" };
    expect(formatOffPlanRequirement(q)).toBe("Emaar · 1BR 750sqft · AED 1.5M");
  });

  it("formats secondary requirement from property type + bedrooms + budget", () => {
    const q = { ...EMPTY_SECONDARY_QUALIFICATION, property_type: "Villa", bedrooms_size: "4BR", budget: "AED 3M" };
    expect(formatSecondaryRequirement(q)).toBe("Villa · 4BR · AED 3M");
  });

  it("skips blank fields cleanly", () => {
    expect(formatOffPlanRequirement(EMPTY_OFF_PLAN_QUALIFICATION)).toBe("");
  });
});

describe("generic campaign outcome storage (one meta key, per-type vocabulary)", () => {
  it("writes and reads a buyer outcome, and bumps listing_stage to match", () => {
    const meta = writeCampaignOutcome("off_plan", {}, {
      status: "qualified",
      at: "2026-09-10T00:00:00.000Z",
      by: "user-1",
    });
    const rec = readCampaignOutcome("off_plan", meta);
    expect(rec?.status).toBe("qualified");
    expect(rec?.by).toBe("user-1");
    expect(readListingStage(meta, null)).toBe("qualified");
  });

  it("rejects reading a listing outcome value as a buyer outcome (wrong vocabulary)", () => {
    const meta = writeCampaignOutcome("listing_acquisition", {}, {
      status: "already_sold_rented",
      at: "2026-09-10T00:00:00.000Z",
    });
    expect(readCampaignOutcome("off_plan", meta)).toBeNull();
    expect(readCampaignOutcome("listing_acquisition", meta)?.status).toBe("already_sold_rented");
  });

  it("returns null when meta has no outcome yet", () => {
    expect(readCampaignOutcome("secondary", {})).toBeNull();
    expect(readCampaignOutcome("secondary", null)).toBeNull();
  });

  it("preserves other meta keys when writing an outcome", () => {
    const meta = writeCampaignOutcome("secondary", { keep: "me" }, {
      status: "interested",
      at: "2026-09-10T00:00:00.000Z",
    });
    expect(meta.keep).toBe("me");
  });
});

describe("campaign type_fields read", () => {
  it("reads off-plan campaign fields with safe defaults", () => {
    const fields = readOffPlanCampaignFields({ developer: "Emaar", project: "Beachfront" });
    expect(fields.developer).toBe("Emaar");
    expect(fields.project).toBe("Beachfront");
    expect(fields.area).toBe("");
  });

  it("reads secondary campaign fields with safe defaults", () => {
    const fields = readSecondaryCampaignFields({ area: "JVC", property_type: "Apartment" });
    expect(fields.area).toBe("JVC");
    expect(fields.buyer_objective).toBe("");
  });

  it("handles null/undefined type_fields without throwing", () => {
    expect(readOffPlanCampaignFields(null).developer).toBe("");
    expect(readSecondaryCampaignFields(undefined).area).toBe("");
  });
});

describe("outcomeLabelsForCampaignType", () => {
  it("shows only the simplified 4-option remark list for listing_acquisition", () => {
    const ids = outcomeLabelsForCampaignType("listing_acquisition").map((o) => o.id);
    expect(ids).toEqual(["interested", "not_interested", "no_response", "already_sold_rented"]);
  });

  it("still validates the full listing outcome vocabulary server-side (not narrowed)", () => {
    expect(isValidOutcomeForCampaignType("listing_acquisition", "converted")).toBe(true);
    expect(isValidOutcomeForCampaignType("listing_acquisition", "qualified")).toBe(true);
    expect(outcomesForCampaignType("listing_acquisition")).toContain("converted");
  });

  it("leaves off_plan/secondary remark lists unchanged (full buyer outcome set)", () => {
    expect(outcomeLabelsForCampaignType("off_plan").map((o) => o.id)).toEqual(
      outcomesForCampaignType("off_plan"),
    );
    expect(outcomeLabelsForCampaignType("secondary").map((o) => o.id)).toEqual(
      outcomesForCampaignType("secondary"),
    );
  });
});

describe("outcome reason", () => {
  it("round-trips an optional reason alongside the outcome", () => {
    const meta = writeCampaignOutcome("listing_acquisition", {}, {
      status: "not_interested",
      at: "2026-09-11T00:00:00.000Z",
      by: "user-1",
      reason: "Wants a higher price",
    });
    const rec = readCampaignOutcome("listing_acquisition", meta);
    expect(rec?.reason).toBe("Wants a higher price");
  });

  it("defaults reason to null when omitted", () => {
    const meta = writeCampaignOutcome("listing_acquisition", {}, {
      status: "interested",
      at: "2026-09-11T00:00:00.000Z",
    });
    expect(readCampaignOutcome("listing_acquisition", meta)?.reason).toBeNull();
  });
});

describe("SIMPLIFIED_LEAD_STAGES", () => {
  it("is exactly Follow-up / Converted / Cancelled — the only manually-picked stages", () => {
    expect(SIMPLIFIED_LEAD_STAGES).toEqual(["follow_up", "converted", "closed"]);
  });

  it("a lead with no stage recorded reads as null (not defaulted to a fake stage)", () => {
    expect(readListingStage({}, null)).toBeNull();
    expect(readListingStage(null, null)).toBeNull();
  });

  it("labels 'closed' as Cancelled to match the simplified stage vocabulary", () => {
    expect(CAMPAIGN_LEAD_STAGE_LABELS.closed).toBe("Cancelled");
  });
});
