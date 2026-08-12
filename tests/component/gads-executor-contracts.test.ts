import { describe, it, expect, vi } from "vitest";

// Stub the live Google Ads read layer so verify() read-backs are testable.
const gaqlSearchMock = vi.fn();
vi.mock("@/lib/growthmind/gads-live-core.server", () => ({
  GADS_BASE: "https://googleads.googleapis.com/test",
  loadGadsCreds: vi.fn(),
  getGadsAccessToken: vi.fn(),
  normalizeGadsCustomerId: (v: any) => (v ? String(v).replace(/\D/g, "") : null),
  parseGoogleAdsFailure: () => ({ codes: [], messages: [], requestId: null }),
  gaqlSearch: (...args: any[]) => gaqlSearchMock(...args),
}));

import { googleAdsExecutor, parseCriterionResource } from "@/lib/marketing/executors/google-ads.executor.server";
import { syncLinkedChangeRequests, runMarketingAction } from "@/lib/marketing/action-engine.server";

function actionWith(over: Partial<any>): any {
  return {
    id: "act-1", workspace_id: "ws-1", source: "test", requested_by: null, objective: null,
    platform: "google_ads", action_type: "budget_change",
    target: { customer_id: "1234567890", campaign_id: "111" },
    existing_value: null, proposed_value: null, expected_impact: null, confidence: null,
    risk_level: "medium", approval_required: true, approval_action_id: null,
    status: "executed", execution_attempts: 1, external_resource_id: null, api_response: null,
    verification_status: null, verification_evidence: null, rollback_payload: null,
    rollback_of: null, evidence: {}, error_message: null, status_history: [],
    created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString(),
    executed_at: null, verified_at: null, measured_at: null,
    ...over,
  };
}

describe("google ads executor contracts", () => {
  it("autopilot allowlist is negative_keyword_add only", () => {
    expect(googleAdsExecutor.autoExecutableActionTypes).toEqual(["negative_keyword_add"]);
  });

  it("buildRollback for a budget change restores the previous budget", () => {
    const rb = googleAdsExecutor.buildRollback!(actionWith({
      proposed_value: { daily_budget: 60 },
      rollback_payload: { kind: "budget_change", campaign_id: "111", previous_daily_budget: 50 },
    }));
    expect(rb?.action_type).toBe("budget_change");
    expect(rb?.proposed_value.daily_budget).toBe(50);
  });

  it("buildRollback for a PARTIAL match-type change (old not paused) still removes the new keyword", () => {
    const rb = googleAdsExecutor.buildRollback!(actionWith({
      action_type: "keyword_match_type_change",
      target: { customer_id: "1234567890", ad_group_id: "22", criterion_id: "33" },
      rollback_payload: { kind: "match_type_revert", new_criterion_resource_name: "customers/1/adGroupCriteria/22~99", ad_group_id: "22", old_criterion_id: "33", old_paused: false },
    }));
    expect(rb?.action_type).toBe("match_type_revert");
    expect(rb?.target.old_paused).toBe(false);
    expect(rb?.target.new_criterion_resource_name).toContain("22~99");
  });

  it("buildRollback returns null when no rollback information was captured", () => {
    expect(googleAdsExecutor.buildRollback!(actionWith({ rollback_payload: null }))).toBeNull();
    expect(googleAdsExecutor.buildRollback!(actionWith({ rollback_payload: { kind: "budget_change", previous_daily_budget: null } }))).toBeNull();
  });
});

describe("rollback verify read-backs", () => {
  const critRow = (id: string, status: string) => ({ adGroupCriterion: { criterionId: id, status } });

  it("parseCriterionResource handles ad-group and campaign criterion names", () => {
    expect(parseCriterionResource("customers/1/adGroupCriteria/22~99")).toEqual({ parentId: "22", criterionId: "99" });
    expect(parseCriterionResource("customers/1/campaignCriteria/111~55")).toEqual({ parentId: "111", criterionId: "55" });
    expect(parseCriterionResource("garbage")).toBeNull();
    expect(parseCriterionResource(null)).toBeNull();
  });

  it("keyword_remove with only a resource name fails verification when keyword is still enabled", async () => {
    gaqlSearchMock.mockReset().mockResolvedValue([critRow("99", "ENABLED")]);
    const res = await googleAdsExecutor.verify!(actionWith({
      action_type: "keyword_remove",
      target: { customer_id: "1234567890", criterion_resource_name: "customers/1/adGroupCriteria/22~99" },
    }));
    expect(res.verified).toBe(false);
  });

  it("keyword_remove verifies when the read-back shows the keyword gone", async () => {
    gaqlSearchMock.mockReset().mockResolvedValue([]);
    const res = await googleAdsExecutor.verify!(actionWith({
      action_type: "keyword_remove",
      target: { customer_id: "1234567890", criterion_resource_name: "customers/1/adGroupCriteria/22~99" },
    }));
    expect(res.verified).toBe(true);
    expect(gaqlSearchMock).toHaveBeenCalled();
  });

  it("keyword_remove NEVER verifies without ids or a parseable resource name", async () => {
    gaqlSearchMock.mockReset();
    const res = await googleAdsExecutor.verify!(actionWith({
      action_type: "keyword_remove",
      target: { customer_id: "1234567890" },
    }));
    expect(res.verified).toBe(false);
    expect(gaqlSearchMock).not.toHaveBeenCalled();
  });

  it("match_type_revert fails verification when the new criterion is still live", async () => {
    // 1st read: old criterion ENABLED (restored); 2nd read: new criterion still ENABLED.
    gaqlSearchMock.mockReset()
      .mockResolvedValueOnce([critRow("33", "ENABLED")])
      .mockResolvedValueOnce([critRow("99", "ENABLED")]);
    const res = await googleAdsExecutor.verify!(actionWith({
      action_type: "match_type_revert",
      target: { customer_id: "1234567890", ad_group_id: "22", old_criterion_id: "33", old_paused: true, new_criterion_resource_name: "customers/1/adGroupCriteria/22~99" },
    }));
    expect(res.verified).toBe(false);
  });

  it("match_type_revert verifies only when old is restored AND new is gone", async () => {
    gaqlSearchMock.mockReset()
      .mockResolvedValueOnce([critRow("33", "ENABLED")])
      .mockResolvedValueOnce([]);
    const res = await googleAdsExecutor.verify!(actionWith({
      action_type: "match_type_revert",
      target: { customer_id: "1234567890", ad_group_id: "22", old_criterion_id: "33", old_paused: true, new_criterion_resource_name: "customers/1/adGroupCriteria/22~99" },
    }));
    expect(res.verified).toBe(true);
  });

  it("negative_keyword_remove without keyword text still read-backs by criterion id", async () => {
    gaqlSearchMock.mockReset().mockResolvedValue([{ campaignCriterion: { criterionId: "55", status: "ENABLED" } }]);
    const res = await googleAdsExecutor.verify!(actionWith({
      action_type: "negative_keyword_remove",
      target: { customer_id: "1234567890", campaign_id: "111", criterion_resource_name: "customers/1/campaignCriteria/111~55" },
    }));
    expect(res.verified).toBe(false);
  });
});

describe("linked change-request sync", () => {
  function stubSb(capture: any) {
    return {
      from(table: string) {
        capture.table = table;
        return {
          update(patch: any) {
            capture.patch = patch;
            return { eq(k1: string, v1: any) { capture[k1] = v1; return { eq(k2: string, v2: any) { capture[k2] = v2; return Promise.resolve({ error: null }); } }; } };
          },
        };
      },
    };
  }

  it("marks linked change requests executed with detail + executed_at, scoped by workspace", async () => {
    const cap: any = {};
    await syncLinkedChangeRequests(stubSb(cap), "ws-1", "act-9", "executed", "done");
    expect(cap.table).toBe("growthmind_gads_change_requests");
    expect(cap.patch.status).toBe("executed");
    expect(cap.patch.status_detail).toBe("done");
    expect(cap.patch.executed_at).toBeTruthy();
    expect(cap.workspace_id).toBe("ws-1");
    expect(cap.marketing_action_id).toBe("act-9");
  });

  it("marks linked change requests failed without executed_at", async () => {
    const cap: any = {};
    await syncLinkedChangeRequests(stubSb(cap), "ws-1", "act-9", "failed", "boom");
    expect(cap.patch.status).toBe("failed");
    expect(cap.patch.executed_at).toBeUndefined();
  });

  it("never throws when the update fails (logged instead)", async () => {
    const sb = { from: () => ({ update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: { message: "db down" } }) }) }) }) };
    await expect(syncLinkedChangeRequests(sb, "ws-1", "a", "failed", "x")).resolves.toBeUndefined();
  });
});

describe("pre-execution failures sync linked change requests", () => {
  function makeSbStub(tables: Record<string, Record<string, any>[]>, syncCapture: any) {
    function query(tableName: string) {
      const state: any = { table: tableName, filters: [] as Array<[string, any]>, update: null };
      const rows = () => (tables[state.table] ?? []).filter((r) =>
        state.filters.every(([k, v]: [string, any]) => String(r[k]) === String(v)));
      const api: any = {
        select() { return api; },
        update(patch: any) { state.update = patch; if (tableName === "growthmind_gads_change_requests") syncCapture.patch = patch; return api; },
        eq(col: string, val: any) { state.filters.push([col, val]); if (tableName === "growthmind_gads_change_requests") syncCapture[col] = val; return api; },
        gte() { return api; }, in() { return api; },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        single: async () => ({ data: rows()[0] ?? null, error: rows()[0] ? null : { message: "no row" } }),
        then(resolve: any) {
          const matched = rows();
          if (state.update && tableName !== "growthmind_gads_change_requests") matched.forEach((r) => Object.assign(r, state.update));
          return Promise.resolve({ data: matched.map((r) => ({ id: r.id })), error: null }).then(resolve);
        },
      };
      return api;
    }
    return { from: (t: string) => query(t) };
  }

  it("stale-autonomy refusal marks the action AND its linked change request failed", async () => {
    const wsId = "00000000-0000-0000-0000-00000000bbbb";
    const actionRow: Record<string, any> = {
      id: "22222222-0000-0000-0000-000000000002", workspace_id: wsId,
      platform: "google_ads", action_type: "budget_change", risk_level: "medium",
      status: "approved", approval_required: true,
      target: { customer_id: "123", campaign_id: "1" }, proposed_value: { daily_budget: 12 },
      execution_attempts: 0, status_history: [], rollback_of: null,
    };
    const cap: any = {};
    const sb = makeSbStub({
      marketing_actions: [actionRow],
      workspace_settings: [{ workspace_id: wsId, marketing_autonomy_level: "observe", marketing_guardrails: {} }],
    }, cap);
    const res = await runMarketingAction(sb as any, wsId, actionRow.id);
    expect(res.outcome).toBe("failed");
    expect(actionRow.status).toBe("failed");
    expect(cap.patch?.status).toBe("failed");
    expect(cap.patch?.status_detail).toContain("observe");
    expect(cap.marketing_action_id).toBe(actionRow.id);
    expect(cap.workspace_id).toBe(wsId);
  });
});
