// Marketing Action Engine — guardrail enforcement (fail-closed) tests.
import { describe, it, expect, beforeAll } from "vitest";
import {
  guardrailBlockReason,
  protectedTargetBlockReason,
  registerMarketingExecutor,
} from "@/lib/marketing/action-engine.server";
import { DEFAULT_MARKETING_GUARDRAILS, normalizeGuardrails } from "@/lib/marketing/action-engine.shared";

const G = { ...DEFAULT_MARKETING_GUARDRAILS, max_daily_ad_spend: 100 };

function action(overrides: Partial<any> = {}) {
  return {
    platform: "test_ads",
    action_type: "budget_change",
    risk_level: "low" as const,
    target: { campaign_name: "Summer Sale" },
    existing_value: { daily_budget: 50 },
    proposed_value: { daily_budget: 55 },
    ...overrides,
  };
}

beforeAll(() => {
  registerMarketingExecutor({
    platform: "test_ads",
    autoExecutableActionTypes: ["budget_change", "campaign_create"],
    async execute() { return { confirmed: false, error: "test stub" }; },
    async verify() { return { verified: false }; },
  });
});

describe("guardrailBlockReason (autopilot gate)", () => {
  it("allows a low-risk allowlisted change within limits", () => {
    expect(guardrailBlockReason(action(), G)).toBeNull();
  });

  it("blocks non-low risk", () => {
    expect(guardrailBlockReason(action({ risk_level: "medium" }), G)).toMatch(/low-risk/);
    expect(guardrailBlockReason(action({ risk_level: "high" }), G)).toMatch(/low-risk/);
  });

  it("blocks high-risk action types regardless of stated risk", () => {
    expect(guardrailBlockReason(action({ action_type: "campaign_delete" }), G)).toBeTruthy();
  });

  it("blocks unknown platforms (no executor) and non-allowlisted action types", () => {
    expect(guardrailBlockReason(action({ platform: "unknown_ads" }), G)).toMatch(/allowlisted/);
    expect(guardrailBlockReason(action({ action_type: "mystery_write" }), G)).toMatch(/allowlisted/);
  });

  it("blocks proposed budget above the per-action cap even with NO existing budget (new campaign)", () => {
    const a = action({ action_type: "campaign_create", existing_value: null, proposed_value: { daily_budget: 150 } });
    expect(guardrailBlockReason(a, G)).toMatch(/per-action budget cap/);
  });

  it("blocks proposed budget above the cap when the existing budget is zero", () => {
    const a = action({ existing_value: { daily_budget: 0 }, proposed_value: { daily_budget: 150 } });
    expect(guardrailBlockReason(a, G)).toMatch(/per-action budget cap/);
  });

  it("blocks budget increases beyond the auto % limit", () => {
    const a = action({ existing_value: { daily_budget: 50 }, proposed_value: { daily_budget: 80 } }); // +60% > 20%
    expect(guardrailBlockReason(a, G)).toMatch(/increase/);
  });

  it("blocks budget decreases beyond the auto % limit", () => {
    const a = action({ existing_value: { daily_budget: 50 }, proposed_value: { daily_budget: 10 } }); // -80% > 50%
    expect(guardrailBlockReason(a, G)).toMatch(/decrease/);
  });

  it("blocks protected targets", () => {
    const g = { ...G, protected_campaigns: ["summer"] };
    expect(guardrailBlockReason(action(), g)).toMatch(/protected campaign/);
  });
});

describe("protectedTargetBlockReason (applies even to approved actions)", () => {
  it("matches case-insensitively across target values", () => {
    const g = { ...DEFAULT_MARKETING_GUARDRAILS, protected_pages: ["/pricing"] };
    expect(protectedTargetBlockReason({ target: { page: "/Pricing" } } as any, g)).toMatch(/protected page/);
    expect(protectedTargetBlockReason({ target: { page: "/pricing-page" } } as any, g)).toMatch(/protected page/);
    expect(protectedTargetBlockReason({ target: { page: "/about" } } as any, g)).toBeNull();
  });
});

describe("normalizeGuardrails", () => {
  it("clamps and defaults malformed input (fail closed shape)", () => {
    const g = normalizeGuardrails({ max_auto_actions_per_day: 99999, max_auto_budget_increase_pct: -5, protected_campaigns: [1, "ok", ""] });
    expect(g.max_auto_actions_per_day).toBe(500);
    expect(g.max_auto_budget_increase_pct).toBe(0);
    expect(g.protected_campaigns).toEqual(["ok"]);
    expect(g.max_daily_ad_spend).toBeNull();
  });
});
