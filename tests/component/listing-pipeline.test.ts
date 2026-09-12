import { describe, expect, it } from "vitest";
import {
  readListingPipeline,
  startListingPipeline,
  writeListingPipelineStage,
  writeListingPipelineOffer,
  daysInListingPipelineStage,
  DEFAULT_LISTING_PIPELINE_STAGE,
  LISTING_PIPELINE_STAGES,
  isListingPipelineStage,
} from "@/lib/whatsapp/campaign-leads.shared";

describe("startListingPipeline", () => {
  it("initializes at 'agreed' with no offer yet", () => {
    const meta = startListingPipeline({}, "2026-09-10T00:00:00.000Z");
    const record = readListingPipeline(meta);
    expect(record?.stage).toBe("agreed");
    expect(record?.enteredAt).toBe("2026-09-10T00:00:00.000Z");
    expect(record?.offerAmount).toBe("");
  });

  it("is a no-op if the pipeline is already started — doesn't reset progress", () => {
    let meta = startListingPipeline({}, "2026-09-10T00:00:00.000Z");
    meta = writeListingPipelineStage(meta, "live", "2026-09-11T00:00:00.000Z");
    meta = startListingPipeline(meta, "2026-09-12T00:00:00.000Z");
    expect(readListingPipeline(meta)?.stage).toBe("live");
  });

  it("preserves other meta keys", () => {
    const meta = startListingPipeline({ keep: "me" });
    expect(meta.keep).toBe("me");
  });
});

describe("writeListingPipelineStage", () => {
  it("bumps enteredAt when the stage actually changes", () => {
    let meta = startListingPipeline({}, "2026-09-10T00:00:00.000Z");
    meta = writeListingPipelineStage(meta, "details_docs", "2026-09-11T00:00:00.000Z");
    expect(readListingPipeline(meta)?.stage).toBe("details_docs");
    expect(readListingPipeline(meta)?.enteredAt).toBe("2026-09-11T00:00:00.000Z");
  });

  it("does NOT bump enteredAt when re-saving the same stage", () => {
    let meta = startListingPipeline({}, "2026-09-10T00:00:00.000Z");
    meta = writeListingPipelineStage(meta, "agreed", "2026-09-15T00:00:00.000Z");
    expect(readListingPipeline(meta)?.enteredAt).toBe("2026-09-10T00:00:00.000Z");
  });

  it("preserves the offer amount across a stage change", () => {
    let meta = startListingPipeline({});
    meta = writeListingPipelineOffer(meta, "AED 1.2M");
    meta = writeListingPipelineStage(meta, "negotiation");
    expect(readListingPipeline(meta)?.offerAmount).toBe("AED 1.2M");
  });
});

describe("daysInListingPipelineStage", () => {
  it("computes whole days elapsed", () => {
    const now = Date.parse("2026-09-13T00:00:00.000Z");
    expect(daysInListingPipelineStage("2026-09-10T00:00:00.000Z", now)).toBe(3);
  });

  it("never goes negative for a future/bad timestamp", () => {
    const now = Date.parse("2026-09-10T00:00:00.000Z");
    expect(daysInListingPipelineStage("2026-09-15T00:00:00.000Z", now)).toBe(0);
    expect(daysInListingPipelineStage("not-a-date", now)).toBe(0);
  });
});

describe("stage set", () => {
  it("matches the spec's exact 8 stages, in order", () => {
    expect(LISTING_PIPELINE_STAGES).toEqual([
      "agreed",
      "details_docs",
      "listing_created",
      "live",
      "viewings_offers",
      "negotiation",
      "sold_by_us",
      "closed",
    ]);
  });

  it("isListingPipelineStage rejects unrelated stage names", () => {
    expect(isListingPipelineStage("agreed")).toBe(true);
    expect(isListingPipelineStage("new_response")).toBe(false);
  });

  it("default stage is 'agreed'", () => {
    expect(DEFAULT_LISTING_PIPELINE_STAGE).toBe("agreed");
  });
});
