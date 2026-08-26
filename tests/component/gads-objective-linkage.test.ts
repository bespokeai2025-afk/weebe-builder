import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMarketingAction, submitMarketingActionForExecution } = vi.hoisted(() => ({
  createMarketingAction: vi.fn(),
  submitMarketingActionForExecution: vi.fn(),
}));

vi.mock("@/lib/marketing/action-engine.server", () => ({
  createMarketingAction,
  submitMarketingActionForExecution,
}));

vi.mock("@/lib/growthmind/gads-negative-policy.server", () => ({
  classifySearchTermFourWay: vi.fn(),
  recordNegativeDecisions: vi.fn(),
}));

import { routeGadsRecommendationToEngine } from "@/lib/growthmind/gads-actions-bridge.server";

const recommendation = {
  id: "rec-1",
  account_row_id: "account-1",
  customer_id: "customer-1",
  campaign_id: "campaign-1",
  section: "budget_opportunity",
  title: "Scale the campaign",
  recommended_action: "Increase budget",
  evidence: { dailyBudget: 100 },
};

describe("Google Ads objective attribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMarketingAction.mockResolvedValue({ id: "action-1" });
    submitMarketingActionForExecution.mockResolvedValue({
      outcome: "awaiting_approval",
      detail: "Queued for approval.",
    });
  });

  it("uses the originating objective when several objectives are active", async () => {
    const from = vi.fn(() => {
      throw new Error("The legacy objective lookup must not run for an exact objective.");
    });

    await routeGadsRecommendationToEngine({ from }, "workspace-1", recommendation, {
      changeRequestId: null,
      userId: "user-1",
      objectiveId: "objective-2",
    });

    expect(createMarketingAction).toHaveBeenCalledWith(
      expect.anything(),
      "workspace-1",
      expect.objectContaining({ objective_id: "objective-2" }),
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("only applies the single-active-objective fallback to legacy rows", async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [{ id: "legacy-objective" }],
      error: null,
    });
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit,
    };
    const sb = { from: vi.fn().mockReturnValue(query) };

    await routeGadsRecommendationToEngine(sb, "workspace-1", recommendation, {
      changeRequestId: null,
      userId: null,
    });

    expect(limit).toHaveBeenCalledWith(2);
    expect(createMarketingAction).toHaveBeenCalledWith(
      sb,
      "workspace-1",
      expect.objectContaining({ objective_id: "legacy-objective" }),
    );
  });
});