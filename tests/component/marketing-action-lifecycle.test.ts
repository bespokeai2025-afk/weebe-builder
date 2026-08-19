// Marketing Action Engine — confirm-then-verify lifecycle with a create-style
// executor: the verifier must receive the confirmed execution fields
// (external_resource_id etc.) and the action must reach "verified".
import { describe, it, expect } from "vitest";
import { registerMarketingExecutor, runMarketingAction } from "@/lib/marketing/action-engine.server";

// ── Minimal in-memory Supabase stub for the calls the engine makes ──────────
function makeSbStub(tables: Record<string, Record<string, any>[]>) {
  function query(tableName: string) {
    const state: any = { table: tableName, filters: [] as Array<[string, any]>, update: null, selectCols: "*" };
    const rows = () => (tables[state.table] ?? []).filter((r) =>
      state.filters.every(([k, v]: [string, any]) => String(r[k]) === String(v)));
    const api: any = {
      select(cols: string) { state.selectCols = cols; return api; },
      update(patch: Record<string, any>) { state.update = patch; return api; },
      eq(col: string, val: any) { state.filters.push([col, val]); return api; },
      gte() { return api; },
      in() { return api; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: rows()[0] ? null : { message: "no row" } }),
      then(resolve: any) {
        // awaited directly after .select("id") on update chains
        const matched = rows();
        if (state.update) matched.forEach((r) => Object.assign(r, state.update));
        return Promise.resolve({ data: matched.map((r) => ({ id: r.id })), error: null }).then(resolve);
      },
    };
    return api;
  }
  return { from: (t: string) => query(t) };
}

describe("runMarketingAction — create executor reaches verified", () => {
  it("passes confirmed execution fields (external_resource_id) to verify()", async () => {
    const wsId = "00000000-0000-0000-0000-00000000aaaa";
    const actionRow: Record<string, any> = {
      id: "11111111-0000-0000-0000-000000000001",
      workspace_id: wsId,
      platform: "test_create_ads",
      action_type: "campaign_create",
      risk_level: "low",
      status: "approved",
      approval_required: true, // human-approved path (skips auto guardrail re-check)
      target: { campaign_name: "New Launch" },
      existing_value: null,
      proposed_value: { daily_budget: 10 },
      execution_attempts: 0,
      status_history: [],
      rollback_of: null,
    };
    const sb = makeSbStub({
      marketing_actions: [actionRow],
      workspace_settings: [{ workspace_id: wsId, marketing_autonomy_level: "approval", marketing_guardrails: {} }],
    });

    let verifySawId: string | null | undefined;
    registerMarketingExecutor({
      platform: "test_create_ads",
      autoExecutableActionTypes: [],
      async execute() {
        return { confirmed: true, apiResponse: { ok: true }, externalResourceId: "ext-campaign-123", rollbackPayload: { delete: "ext-campaign-123" } };
      },
      async verify(action) {
        verifySawId = action.external_resource_id;
        return { verified: action.external_resource_id === "ext-campaign-123", observedState: { id: action.external_resource_id } };
      },
    });

    const result = await runMarketingAction(sb as any, wsId, actionRow.id);
    expect(result.outcome).toBe("executed");
    expect(verifySawId).toBe("ext-campaign-123");
    expect(actionRow.status).toBe("verified");
    expect(actionRow.verification_status).toBe("verified");
    expect(actionRow.external_resource_id).toBe("ext-campaign-123");
    expect(actionRow.rollback_payload).toEqual({ delete: "ext-campaign-123" });
  });
});
