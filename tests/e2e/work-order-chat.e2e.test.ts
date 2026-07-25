/**
 * Chat-initiated work orders (e2e, real DB).
 *
 * Verifies the conversational work-order milestone:
 *   • hivemind.create_gads_analysis_work_order resolves a named campaign
 *     against REAL synced campaign rows (growthmind_gads_campaign_daily)
 *   • exact/partial resolution creates work order + executable task with
 *     input_spec.focus_campaign (same record chain as the manual button)
 *   • ambiguous fragment → candidates returned, NOTHING created
 *   • unknown campaign → not_found with real campaign candidates
 *   • proposal only: task starts suggested / awaiting_approval
 *   • hivemind.get_work_order_status reports the real task/execution state
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { executeMindTool, mindToolsReady } from "@/lib/minds/tool-registry.server";
import { PACKAGE_CATALOG } from "@/lib/packages/packages.shared";

const sb = supabaseAdmin as any;

const WS = randomUUID();
const ACCT_ROW = randomUUID();
let ownerUserId: string;

const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  await mindToolsReady();
  const { data: profiles, error } = await sb.from("profiles").select("user_id").limit(1);
  if (error || !profiles?.length) throw new Error("Need an existing user for workspace fixture");
  ownerUserId = profiles[0].user_id;

  const { error: wErr } = await sb.from("workspaces").insert({
    id: WS,
    name: `wo-chat e2e ${WS.slice(0, 8)}`,
    slug: `wo-chat-e2e-${WS.slice(0, 8)}`,
    owner_id: ownerUserId,
  });
  if (wErr) throw new Error(`workspace fixture: ${wErr.message}`);
  const { error: mErr } = await sb.from("workspace_members").insert({
    workspace_id: WS, user_id: ownerUserId, role: "owner",
  });
  if (mErr) throw new Error(`membership fixture: ${mErr.message}`);

  // Entitlement + non-observe mode so proposals are allowed.
  const pkg = PACKAGE_CATALOG.find((p: any) => p.aiDepartments?.includes("growthmind"));
  if (!pkg) throw new Error("No package with growthmind department");
  const { error: sErr } = await sb.from("workspace_subscriptions").insert({
    workspace_id: WS, package_key: (pkg as any).packageKey, subscription_status: "active",
  });
  if (sErr) throw new Error(`subscription fixture: ${sErr.message}`);
  await sb.from("workspace_settings").upsert(
    { workspace_id: WS, hivemind_mode: "assistant" },
    { onConflict: "workspace_id" },
  );
  const { invalidateEntitlementsCache } = await import("@/lib/packages/entitlements.server");
  invalidateEntitlementsCache(WS);

  // Real synced campaign rows (the ONLY source the resolver reads).
  const rows = [
    { campaign_id: "111", name: "Search for US and Reception", cost_micros: 42_000_000 },
    { campaign_id: "222", name: "Search Brand UK", cost_micros: 10_000_000 },
    { campaign_id: "333", name: "Search Generic UK", cost_micros: 5_000_000 },
  ].map((c) => ({
    workspace_id: WS,
    account_row_id: ACCT_ROW,
    customer_id: "9999999999",
    campaign_id: c.campaign_id,
    date: today,
    name: c.name,
    status: "ENABLED",
    channel_type: "SEARCH",
    cost_micros: c.cost_micros,
    impressions: 100,
    clicks: 10,
  }));
  const { error: dErr } = await sb.from("growthmind_gads_campaign_daily").insert(rows);
  if (dErr) throw new Error(`campaign daily fixture: ${dErr.message}`);
}, 60_000);

afterAll(async () => {
  await sb.from("mind_task_executions").delete().eq("workspace_id", WS);
  await sb.from("hivemind_actions").delete().eq("workspace_id", WS);
  await sb.from("hivemind_tasks").delete().eq("workspace_id", WS);
  await sb.from("work_orders").delete().eq("workspace_id", WS);
  await sb.from("mind_tool_executions").delete().eq("workspace_id", WS);
  await sb.from("growthmind_gads_campaign_daily").delete().eq("workspace_id", WS);
  await sb.from("workspace_subscriptions").delete().eq("workspace_id", WS);
  await sb.from("workspace_settings").delete().eq("workspace_id", WS);
  await sb.from("workspace_members").delete().eq("workspace_id", WS);
  await sb.from("workspaces").delete().eq("id", WS);
}, 60_000);

function run(input: Record<string, unknown>, toolName = "hivemind.create_gads_analysis_work_order") {
  return executeMindTool({
    sb, workspaceId: WS, userId: ownerUserId, platform: "web",
    toolName, input, initiatedBy: "user",
  });
}

describe("create_gads_analysis_work_order", () => {
  it("ambiguous fragment returns candidates and creates nothing", async () => {
    const res = await run({ campaignName: "Search" });
    expect(res.status).toBe("completed");
    const r = (res.result ?? {}) as any;
    expect(r.status).toBe("ambiguous");
    expect(r.candidates.length).toBeGreaterThan(1);
    const { data: wos } = await sb.from("work_orders").select("id").eq("workspace_id", WS);
    expect(wos ?? []).toHaveLength(0);
  });

  it("unknown campaign returns not_found with real candidates", async () => {
    const res = await run({ campaignName: "Nonexistent Campaign Zebra" });
    const r = (res.result ?? {}) as any;
    expect(r.status).toBe("not_found");
    expect((r.candidates ?? []).map((c: any) => c.name)).toContain("Search Brand UK");
  });

  it("resolves the user's phrase to the focused campaign and creates the full chain as a proposal", async () => {
    const res = await run({ campaignName: "Search for US and Reception" });
    expect(res.status).toBe("completed");
    const r = (res.result ?? {}) as any;
    expect(r.status).toBe("created");
    expect(r.focusCampaign).toEqual({ campaignId: "111", campaignName: "Search for US and Reception" });
    expect(r.workOrderId).toBeTruthy();
    expect(r.taskId).toBeTruthy();

    const { data: wo } = await sb.from("work_orders").select("*").eq("id", r.workOrderId).single();
    expect(wo.workspace_id).toBe(WS);
    expect(wo.source).toBe("hivemind_chat");
    expect(wo.status).toBe("open");
    expect(wo.metadata.focus_campaign_id).toBe("111");

    const { data: task } = await sb.from("hivemind_tasks").select("*").eq("id", r.taskId).single();
    expect(task.work_order_id).toBe(r.workOrderId);
    expect(task.status).toBe("suggested");
    expect(task.execution_status).toBe("awaiting_approval");
    expect(task.action_kind).toBe("growthmind.gads_campaign_analysis");
    expect(task.input_spec.focus_campaign).toEqual({
      campaign_id: "111",
      campaign_name: "Search for US and Reception",
    });

    // Proposal only — no execution rows yet.
    const { data: execs } = await sb.from("mind_task_executions").select("id").eq("task_id", r.taskId);
    expect(execs ?? []).toHaveLength(0);
  });

  it("resolves the raw conversational utterance (intent words + trailing 'campaign')", async () => {
    const res = await run({ campaignName: "Improve the Search for US and Reception campaign" });
    const r = (res.result ?? {}) as any;
    expect(r.status).toBe("created");
    expect(r.focusCampaign?.campaignId).toBe("111");
  });

  it("get_work_order_status reports the real (awaiting approval) state", async () => {
    const res = await run({}, "hivemind.get_work_order_status");
    expect(res.status).toBe("completed");
    const tasks = ((res.result ?? {}) as any).workOrderTasks as any[];
    expect(tasks.length).toBeGreaterThan(0);
    const t = tasks.find((x) => x.executionStatus === "awaiting_approval");
    expect(t).toBeTruthy();
    expect(t.latestExecution).toBeNull();
    expect(t.linkedActions).toHaveLength(0);
  });
});
