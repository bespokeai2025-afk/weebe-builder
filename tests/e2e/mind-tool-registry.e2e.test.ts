/**
 * Shared Mind tool registry (e2e, real DB).
 *
 * Verifies:
 *   • catalog registration: all 12 HiveMind action kinds + declared
 *     GrowthMind/SystemMind/AccountsMind capabilities present
 *   • unknown tool → blocked
 *   • non-member user → blocked (fail closed) with audit row
 *   • sensitive tool without explicit approval → approval_required
 *   • Mind-initiated write under observe mode → blocked by mode gate
 *   • real execution (hivemind.create_task) → completed with audit lifecycle
 *     (started_at/finished_at, affected record, result summary)
 *   • parameter scrubbing redacts credential-shaped keys/values
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  executeMindTool,
  listMindTools,
  mindToolsReady,
  scrubToolParams,
} from "@/lib/minds/tool-registry.server";

const sb = supabaseAdmin as any;

const WS = randomUUID();
const OUTSIDER = randomUUID();
let ownerUserId: string;

beforeAll(async () => {
  const { data: profiles, error } = await sb.from("profiles").select("user_id").limit(1);
  if (error || !profiles?.length) throw new Error("Need an existing user for workspace fixture");
  ownerUserId = profiles[0].user_id;

  const { error: wErr } = await sb.from("workspaces").insert({
    id: WS,
    name: `mind-tools e2e ${WS.slice(0, 8)}`,
    slug: `mind-tools-e2e-${WS.slice(0, 8)}`,
    owner_id: ownerUserId,
  });
  if (wErr) throw new Error(`fixture workspace insert failed: ${wErr.message}`);
  const { error: mErr } = await sb.from("workspace_members").insert({
    workspace_id: WS,
    user_id: ownerUserId,
    role: "owner",
  });
  if (mErr) throw new Error(`fixture membership insert failed: ${mErr.message}`);
}, 60_000);

afterAll(async () => {
  await sb.from("mind_tool_executions").delete().eq("workspace_id", WS);
  await sb.from("workspace_subscriptions").delete().eq("workspace_id", WS);
  await sb.from("hivemind_tasks").delete().eq("workspace_id", WS);
  await sb.from("workspace_settings").delete().eq("workspace_id", WS);
  await sb.from("workspace_members").delete().eq("workspace_id", WS);
  await sb.from("workspaces").delete().eq("id", WS);
}, 60_000);

describe("registry catalog", () => {
  it("registers all HiveMind action kinds and declared Mind capabilities", async () => {
    await mindToolsReady();
    const names = listMindTools().map((t) => t.name);
    for (const k of [
      "create_task", "create_followup_campaign", "enroll_leads_in_campaign",
      "move_pipeline_stage", "assign_knowledge_base", "sync_ad_stats",
      "register_resend_webhook",
      "growthmind_video_campaign", "growthmind_growth_campaign",
      "growthmind_publish_content", "send_workflow_draft_to_builder",
      "activate_lead_intake_workflow", "activate_systemmind_automation",
    ]) {
      expect(names).toContain(`hivemind.${k}`);
    }
    expect(names).toContain("accountsmind.record_invoice_payment");
    expect(names).toContain("growthmind.submit_content_for_approval");
    expect(names).toContain("systemmind.build_session");
  });

  it("guardrail: every executeAction case has a registered registry tool", async () => {
    // Prevent drift between hivemind.actions.ts executeAction and the registry:
    // approving an action whose type isn't registered would fail at runtime.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/hivemind/hivemind.actions.ts", "utf8");
    const body = src.slice(src.indexOf("export async function executeAction"));
    const caseTypes = [...body.matchAll(/case "([a-z0-9_]+)":/g)].map((m) => m[1]);
    const names = new Set(listMindTools().map((t) => t.name));
    const missing = [...new Set(caseTypes)].filter((t) => !names.has(`hivemind.${t}`));
    expect(missing).toEqual([]);
  });

  it("sensitive classification follows action-safety rules", async () => {
    const tools = listMindTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get("hivemind.activate_systemmind_automation")?.sensitive).toBe(true);
    expect(byName.get("accountsmind.record_invoice_payment")?.sensitive).toBe(true);
    expect(byName.get("hivemind.create_task")?.sensitive).toBe(false);
  });
});

describe("executeMindTool guards (fail closed)", () => {
  it("blocks unknown tools", async () => {
    const res = await executeMindTool({
      sb, workspaceId: WS, userId: ownerUserId, platform: "web",
      toolName: "hivemind.nonexistent_tool", input: {}, initiatedBy: "user",
    });
    expect(res.status).toBe("blocked");
  });

  it("blocks non-members and writes an audit row", async () => {
    const res = await executeMindTool({
      sb, workspaceId: WS, userId: OUTSIDER, platform: "web",
      toolName: "hivemind.create_task",
      input: { action: { id: randomUUID(), action_type: "create_task", action_payload: { title: "x" } } },
      initiatedBy: "user",
    });
    expect(res.status).toBe("blocked");
    expect(res.executionId).toBeTruthy();
    const { data: row } = await sb.from("mind_tool_executions").select("status,user_id").eq("id", res.executionId).single();
    expect(row.status).toBe("blocked");
    expect(row.user_id).toBe(OUTSIDER);
  });

  it("requires explicit approval for sensitive tools", async () => {
    // Grant a package that includes SystemMind so the entitlement guard
    // passes and the approval gate is what fires.
    const { PACKAGE_CATALOG } = await import("@/lib/packages/packages.shared");
    const full = PACKAGE_CATALOG.find((p: any) => p.aiDepartments?.includes("systemmind"));
    if (!full) throw new Error("No package with systemmind department in catalog");
    await sb.from("workspace_subscriptions").delete().eq("workspace_id", WS);
    const { error: subErr } = await sb.from("workspace_subscriptions").insert({
      workspace_id: WS,
      package_key: (full as any).packageKey,
      subscription_status: "active",
    });
    if (subErr) throw new Error(subErr.message);
    const { invalidateEntitlementsCache } = await import("@/lib/packages/entitlements.server");
    invalidateEntitlementsCache(WS);

    const res = await executeMindTool({
      sb, workspaceId: WS, userId: ownerUserId, platform: "web",
      toolName: "hivemind.activate_systemmind_automation",
      input: { action: { id: randomUUID(), action_type: "activate_systemmind_automation", action_payload: {} } },
      initiatedBy: "user",
      // no explicitApproval
    });
    expect(res.status).toBe("approval_required");
  });

  it("mode-gates Mind-initiated writes (observe mode → blocked)", async () => {
    await sb.from("workspace_settings").upsert(
      { workspace_id: WS, hivemind_mode: "observe" },
      { onConflict: "workspace_id" },
    );
    const res = await executeMindTool({
      sb, workspaceId: WS, userId: null, platform: "system",
      toolName: "hivemind.create_task",
      input: { action: { id: randomUUID(), action_type: "create_task", action_payload: { title: "should not run" } } },
      initiatedBy: "mind",
    });
    expect(res.status).toBe("blocked");
    const { data: tasks } = await sb.from("hivemind_tasks").select("id").eq("workspace_id", WS).eq("title", "should not run");
    expect(tasks ?? []).toHaveLength(0);
  });
});

describe("real execution with audit lifecycle", () => {
  it("runs hivemind.create_task to completion and audits it", async () => {
    const actionId = randomUUID();
    const res = await executeMindTool({
      sb, workspaceId: WS, userId: ownerUserId, platform: "web",
      toolName: "hivemind.create_task",
      input: { action: { id: actionId, action_type: "create_task", action_payload: { title: "e2e registry task" } } },
      initiatedBy: "user",
      explicitApproval: true,
      approvalRef: actionId,
    });
    expect(res.status).toBe("completed");
    expect(res.result?.task_id).toBeTruthy();

    const { data: audit } = await sb.from("mind_tool_executions").select("*").eq("id", res.executionId).single();
    expect(audit.status).toBe("completed");
    expect(audit.started_at).toBeTruthy();
    expect(audit.finished_at).toBeTruthy();
    expect(audit.approval_ref).toBe(actionId);
    expect(audit.affected_record_type).toBe("hivemind_task");
    expect(audit.tool_name).toBe("hivemind.create_task");
    expect(audit.platform).toBe("web");

    const { data: task } = await sb.from("hivemind_tasks").select("title").eq("id", res.result!.task_id).single();
    expect(task.title).toBe("e2e registry task");
  });

  it("records failed runs truthfully (no optimistic success)", async () => {
    const res = await executeMindTool({
      sb, workspaceId: WS, userId: ownerUserId, platform: "web",
      toolName: "hivemind.move_pipeline_stage",
      input: { action: { id: randomUUID(), action_type: "create_task", action_payload: {} } }, // type mismatch → throws
      initiatedBy: "user",
      explicitApproval: true,
    });
    expect(res.status).toBe("failed");
    const { data: audit } = await sb.from("mind_tool_executions").select("status,error_message").eq("id", res.executionId).single();
    expect(audit.status).toBe("failed");
    expect(audit.error_message).toContain("mismatch");
  });
});

describe("parameter scrubbing", () => {
  it("redacts credential-shaped keys and values", () => {
    const scrubbed = scrubToolParams({
      apiKey: "sk-abc123",
      nested: { authorization: "Bearer xyz", ok: "value" },
      token: "whatever",
      plain: "sk-live_secretvalue",
    }) as any;
    expect(scrubbed.apiKey).toBe("[redacted]");
    expect(scrubbed.nested.authorization).toBe("[redacted]");
    expect(scrubbed.token).toBe("[redacted]");
    expect(scrubbed.plain).toBe("[redacted]");
    expect(scrubbed.nested.ok).toBe("value");
  });
});
