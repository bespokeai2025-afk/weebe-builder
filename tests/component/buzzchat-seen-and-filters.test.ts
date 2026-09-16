import { describe, expect, it } from "vitest";
import {
  FILTERABLE_LEAD_STAGES,
  SIMPLIFIED_LEAD_STAGES,
  SIMPLIFIED_LISTING_REMARKS,
  CAMPAIGN_LEAD_STAGE_LABELS,
  LISTING_OUTCOME_LABELS,
  isWhatsappThreadSeen,
} from "@/lib/whatsapp/campaign-leads.shared";

describe("isWhatsappThreadSeen", () => {
  const read = "2026-09-16T10:00:00.000Z";

  it("is seen once the thread has been opened after its newest message", () => {
    expect(isWhatsappThreadSeen(read, "2026-09-16T09:59:00.000Z")).toBe(true);
  });

  it("goes unread again when a newer message arrives", () => {
    // The self-correcting half: no job has to reset anything.
    expect(isWhatsappThreadSeen(read, "2026-09-16T10:01:00.000Z")).toBe(false);
  });

  it("treats an exact tie as seen", () => {
    expect(isWhatsappThreadSeen(read, read)).toBe(true);
  });

  it("is unseen when never opened", () => {
    // What Mark unread writes — null last_read_at brings the dot back.
    expect(isWhatsappThreadSeen(null, "2026-09-16T09:00:00.000Z")).toBe(false);
    expect(isWhatsappThreadSeen(undefined, "2026-09-16T09:00:00.000Z")).toBe(false);
  });

  it("counts an opened but empty thread as seen", () => {
    expect(isWhatsappThreadSeen(read, null)).toBe(true);
  });

  it("does not claim seen on unparseable timestamps", () => {
    expect(isWhatsappThreadSeen("not-a-date", "2026-09-16T09:00:00.000Z")).toBe(false);
    expect(isWhatsappThreadSeen(read, "nonsense")).toBe(false);
  });
});

describe("lead status filters cover the statuses the team asked for", () => {
  const labels = [
    ...FILTERABLE_LEAD_STAGES.map((s) => CAMPAIGN_LEAD_STAGE_LABELS[s]),
    ...SIMPLIFIED_LISTING_REMARKS.map((r) => LISTING_OUTCOME_LABELS[r]),
  ];

  it.each([
    "Interested",
    "Not interested",
    "Qualified",
    "Assigned",
    "Follow-up",
    "Converted",
    "Already sold / rented",
    "No response",
  ])("offers a %s filter", (label) => {
    expect(labels).toContain(label);
  });

  it("keeps the hand-pickable stages narrowed to three", () => {
    // Filtering by Qualified/Assigned must not make them selectable by hand —
    // both are reached through the pipeline, not the dropdown.
    expect([...SIMPLIFIED_LEAD_STAGES]).toEqual(["follow_up", "converted", "closed"]);
    for (const stage of SIMPLIFIED_LEAD_STAGES) {
      expect(FILTERABLE_LEAD_STAGES).toContain(stage);
    }
    expect(FILTERABLE_LEAD_STAGES).toContain("qualified");
    expect(FILTERABLE_LEAD_STAGES).toContain("assigned");
  });

  it("leaves the automatic stages out so they stay under Not set", () => {
    for (const auto of ["new_response", "contacted", "engaged", "no_activity"]) {
      expect(FILTERABLE_LEAD_STAGES).not.toContain(auto);
    }
  });
});
