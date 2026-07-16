/**
 * E2E tests for the SystemMind Test Call Validation Loop.
 *
 * Covers: workspace-scoped call loading, candidate listing, manual pass
 * override (reason required + audit), gate derivation per version, the
 * MANDATORY Go Live gate for build sessions (applyBuildVersionServer
 * goLiveIntent + markBuildVersionDeployedServer both throw without a passed
 * test), the deployment-checklist mandatory item for build-linked deployments,
 * and that standard (non-build) deployments keep the original optional
 * test-call behaviour.
 *
 * Never calls the AI model — analysis paths that would hit routeGenerate are
 * exercised only via the deterministic override/gate functions.
 *
 * Runs against the REAL shared Supabase database (service role) using
 * throw-away workspaces, and cleans up everything it creates.
 *
 * Run: npx vitest run --config vitest.e2e.config.ts tests/e2e/build-workspace-testcall.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  listTestCallCandidatesServer,
  overrideTestPassedServer,
  getTestGateForSessionServer,
  getTestCallStateServer,
  deriveExpectedOutcome,
} from "@/lib/systemmind/build-workspace-testcall.server";
import {
  markBuildVersionDeployedServer,
} from "@/lib/systemmind/build-workspace.server";
import {
  getOrCreateDeploymentServer,
  computeDeploymentChecklistServer,
} from "@/lib/systemmind/deployment-orchestrator.server";

const sb = supabaseAdmin as any;
const WS = randomUUID();
let OWNER = "";
let AGENT = "";
let SESSION = "";
let VERSION = "";

const CONFIG = {
  agent_prompt: "You are a friendly booking agent.",
  workflow: {
    name: "e2e testcall workflow",
    purpose: "test",
    trigger_type: "manual",
    trigger_config: {},
    steps: [{ id: "step-0-trigger", type: "trigger", next: null }],
  },
  variables: [{ name: "customer_name" }],
  extraction_fields: [{ name: "appointment_time" }],
  follow_up_rules: [],
  channel_setup: {},
  required_credentials: [],
  risks: [],
  test_plan: [],
};

beforeAll(async () => {
  const { data: anyWs } = await sb.from("workspaces").select("owner_id").limit(1).single();
  OWNER = anyWs.owner_id as string;
  const { error: wErr } = await sb.from("workspaces").insert({
    id: WS, name: "e2e testcall ws", owner_id: OWNER, slug: `e2e-tc-${WS.slice(0, 8)}`,
  });
  if (wErr) throw new Error(wErr.message);
  const { data: agent, error: aErr } = await sb.from("agents")
    .insert({ workspace_id: WS, user_id: OWNER, name: "e2e tc agent", settings: { deployedRetellAgentId: "agent_e2e_tc", dashboardAgentType: "receptionist" } })
    .select("id").single();
  if (aErr) throw new Error(aErr.message);
  AGENT = agent.id;

  const { data: session, error: sErr } = await sb.from("systemmind_build_sessions")
    .insert({ workspace_id: WS, created_by_user_id: OWNER, title: "e2e tc session", status: "active", source_page: "agent_builder", target_agent_id: AGENT })
    .select("id").single();
  if (sErr) throw new Error(sErr.message);
  SESSION = session.id;

  const { data: version, error: vErr } = await sb.from("systemmind_build_versions")
    .insert({ session_id: SESSION, workspace_id: WS, created_by_user_id: OWNER, version_number: 1, user_prompt: "e2e", assistant_summary: "e2e", generated_config: CONFIG, risk_level: "low", risk_reasons: [], status: "applied" })
    .select("id").single();
  if (vErr) throw new Error(vErr.message);
  VERSION = version.id;
  await sb.from("systemmind_build_sessions").update({ current_version_id: VERSION }).eq("id", SESSION);
});

afterAll(async () => {
  await sb.from("hivemind_actions").delete().eq("workspace_id", WS);
  await sb.from("systemmind_generated_actions").delete().eq("workspace_id", WS);
  await sb.from("systemmind_test_calls").delete().eq("workspace_id", WS);
  await sb.from("systemmind_deployments").delete().eq("workspace_id", WS);
  await sb.from("systemmind_audit_logs").delete().eq("workspace_id", WS);
  await sb.from("systemmind_build_messages").delete().eq("workspace_id", WS);
  await sb.from("systemmind_build_versions").delete().eq("workspace_id", WS);
  await sb.from("systemmind_build_sessions").delete().eq("workspace_id", WS);
  await sb.from("calls").delete().eq("workspace_id", WS);
  await sb.from("agents").delete().eq("workspace_id", WS);
  await sb.from("workspaces").delete().eq("id", WS);
});

describe("expected outcome derivation", () => {
  it("includes config fields and scenario expectations", () => {
    const exp = deriveExpectedOutcome(CONFIG, "positive_booked") as any;
    expect(exp.expected_extraction_fields).toContain("appointment_time");
    expect(exp.expected_sentiment).toBe("positive");
    expect(exp.appointment_booked).toBe(true);
  });
});

describe("candidates + scoping", () => {
  it("lists only this workspace/agent's recent calls, without transcripts", async () => {
    await sb.from("calls").insert({
      workspace_id: WS, agent_id: AGENT, to_number: "unknown", call_status: "completed",
      transcript: "Agent: hello. Caller: I want to book.", duration_seconds: 42,
    });
    const rows = await listTestCallCandidatesServer({ workspaceId: WS, sessionId: SESSION });
    expect(rows.length).toBe(1);
    expect(rows[0].transcript).toBeUndefined();
    expect(rows[0].has_transcript).toBe(true);
  });

  it("analyze rejects a call made to a different agent in the same workspace", async () => {
    const { analyzeTestCallServer } = await import("@/lib/systemmind/build-workspace-testcall.server");
    const { data: otherAgent } = await sb.from("agents")
      .insert({ workspace_id: WS, user_id: OWNER, name: "e2e other agent", settings: {} })
      .select("id").single();
    const { data: otherCall } = await sb.from("calls")
      .insert({ workspace_id: WS, agent_id: otherAgent.id, to_number: "unknown", call_status: "completed", transcript: "Agent: hi. Caller: book me in.", duration_seconds: 30 })
      .select("id").single();
    await expect(
      analyzeTestCallServer({ workspaceId: WS, userId: OWNER, sessionId: SESSION, callId: otherCall.id, scenario: "positive_booked" }),
    ).rejects.toThrow(/different agent/i);
  });

  it("rejects a session from another workspace", async () => {
    await expect(
      listTestCallCandidatesServer({ workspaceId: randomUUID(), sessionId: SESSION }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("mandatory gate", () => {
  it("gate is not_tested before any test rows", async () => {
    const gate = await getTestGateForSessionServer({ workspaceId: WS, sessionId: SESSION, versionId: VERSION });
    expect(gate.status).toBe("not_tested");
  });

  it("markBuildVersionDeployedServer blocks without a passed test", async () => {
    await expect(
      markBuildVersionDeployedServer({ workspaceId: WS, userId: OWNER, sessionId: SESSION, versionId: VERSION }),
    ).rejects.toThrow(/test call/i);
  });

  it("checklist marks test_call_passed as required+missing for build-linked deployments", async () => {
    // Link an active_version_id so getOrCreateDeploymentServer records the build linkage.
    await sb.from("systemmind_build_sessions").update({ active_version_id: VERSION } as any).eq("id", SESSION);
    const { deploymentId } = await getOrCreateDeploymentServer({ workspaceId: WS, userId: OWNER, agentId: AGENT });
    // Force the linkage in case the session column name differs.
    await sb.from("systemmind_deployments").update({ build_session_id: SESSION, build_version_id: VERSION }).eq("id", deploymentId);
    const checklist = await computeDeploymentChecklistServer({ workspaceId: WS, deploymentId });
    const item = checklist.items.find((i: any) => i.key === "test_call_passed");
    expect(item.status).toBe("missing");
    expect(checklist.blockers.join(" ")).toMatch(/test call/i);
    expect(checklist.goLiveReady).toBe(false);
  });

  it("checklist override test_call=passed does NOT unlock the gate for build deployments", async () => {
    const { deploymentId } = await getOrCreateDeploymentServer({ workspaceId: WS, userId: OWNER, agentId: AGENT });
    await sb.from("systemmind_deployments").update({
      checklist_overrides: { test_call: "passed" },
    }).eq("id", deploymentId);
    const checklist = await computeDeploymentChecklistServer({ workspaceId: WS, deploymentId });
    const item = checklist.items.find((i: any) => i.key === "test_call_passed");
    expect(item.status).toBe("missing");
    expect(checklist.goLiveReady).toBe(false);
    await sb.from("systemmind_deployments").update({ checklist_overrides: {} }).eq("id", deploymentId);
  });

  it("override requires a reason and then passes the gate", async () => {
    await expect(
      overrideTestPassedServer({ workspaceId: WS, userId: OWNER, sessionId: SESSION, reason: "  " }),
    ).rejects.toThrow(/reason/i);

    const row = await overrideTestPassedServer({
      workspaceId: WS, userId: OWNER, sessionId: SESSION, reason: "e2e verified manually",
    });
    expect(row.passed).toBe(true);
    expect(row.is_manual_override).toBe(true);

    const gate = await getTestGateForSessionServer({ workspaceId: WS, sessionId: SESSION, versionId: VERSION });
    expect(gate.status).toBe("passed");

    // markDeployed now goes through the gate (may still succeed fully).
    await markBuildVersionDeployedServer({ workspaceId: WS, userId: OWNER, sessionId: SESSION, versionId: VERSION });
    const { data: v } = await sb.from("systemmind_build_versions").select("status").eq("id", VERSION).single();
    expect(v.status).toBe("deployed");
  });

  it("checklist test item completes after the gate passes", async () => {
    const { deploymentId } = await getOrCreateDeploymentServer({ workspaceId: WS, userId: OWNER, agentId: AGENT });
    const checklist = await computeDeploymentChecklistServer({ workspaceId: WS, deploymentId });
    const item = checklist.items.find((i: any) => i.key === "test_call_passed");
    expect(item.status).toBe("complete");
  });

  it("state endpoint returns gate + history", async () => {
    const state = await getTestCallStateServer({ workspaceId: WS, sessionId: SESSION });
    expect(state.gate.status).toBe("passed");
    expect(state.history.length).toBeGreaterThan(0);
    expect(state.versionId).toBe(VERSION);
  });
});

describe("standard agents untouched", () => {
  it("non-build deployment keeps optional test-call behaviour", async () => {
    const { data: agent2 } = await sb.from("agents")
      .insert({ workspace_id: WS, user_id: OWNER, name: "e2e standard agent", settings: { deployedRetellAgentId: "agent_e2e_std", dashboardAgentType: "receptionist" } })
      .select("id").single();
    const { deploymentId } = await getOrCreateDeploymentServer({ workspaceId: WS, userId: OWNER, agentId: agent2.id });
    const checklist = await computeDeploymentChecklistServer({ workspaceId: WS, deploymentId });
    const item = checklist.items.find((i: any) => i.key === "test_call_passed");
    expect(item.status).toBe("missing");
    // NOT a blocker for standard agents — only failed tests block them.
    expect(checklist.blockers.join(" ")).not.toMatch(/test call/i);
  });
});

describe("HiveMind-controlled override", () => {
  let WS2 = "";
  let SESSION2 = "";
  let hubId = "";
  let hmActionId = "";

  beforeAll(async () => {
    WS2 = randomUUID();
    await sb.from("workspaces").insert({ id: WS2, name: "e2e tc hm ws", owner_id: OWNER, slug: `e2e-tchm-${WS2.slice(0, 8)}` });
    const { data: agent } = await sb.from("agents")
      .insert({ workspace_id: WS2, user_id: OWNER, name: "e2e hm agent", settings: {} })
      .select("id").single();
    const { data: session } = await sb.from("systemmind_build_sessions")
      .insert({ workspace_id: WS2, created_by_user_id: OWNER, title: "e2e hm session", status: "active", source_page: "agent_builder", target_agent_id: agent.id })
      .select("id").single();
    SESSION2 = session.id;
    const { data: version } = await sb.from("systemmind_build_versions")
      .insert({ session_id: SESSION2, workspace_id: WS2, created_by_user_id: OWNER, version_number: 1, user_prompt: "e2e", assistant_summary: "e2e", generated_config: CONFIG, risk_level: "low", risk_reasons: [], status: "applied" })
      .select("id").single();
    await sb.from("systemmind_build_sessions").update({ current_version_id: version.id }).eq("id", SESSION2);
  });

  afterAll(async () => {
    for (const t of ["hivemind_actions", "systemmind_generated_actions", "systemmind_test_calls", "systemmind_audit_logs", "systemmind_usage_events", "systemmind_build_messages", "systemmind_build_versions", "systemmind_build_sessions", "agents"]) {
      await sb.from(t).delete().eq("workspace_id", WS2);
    }
    await sb.from("workspaces").delete().eq("id", WS2);
  });

  it("request creates a pending hub draft + HiveMind action, gate stays closed", async () => {
    const { requestTestOverrideApprovalServer } = await import("@/lib/systemmind/build-workspace-testcall.server");
    const res = await requestTestOverrideApprovalServer({ workspaceId: WS2, userId: OWNER, sessionId: SESSION2, reason: "e2e manual pass request" });
    hubId = res.hubActionId;
    hmActionId = res.hivemindActionId;
    expect(hubId).toBeTruthy();
    expect(hmActionId).toBeTruthy();

    const { data: hub } = await sb.from("systemmind_generated_actions").select("status, action_kind, risk_level").eq("id", hubId).single();
    expect(hub.status).toBe("pending_approval");
    expect(hub.action_kind).toBe("build_test_override");
    expect(hub.risk_level).toBe("high");

    const { data: act } = await sb.from("hivemind_actions").select("status, action_type").eq("id", hmActionId).single();
    expect(act.status).toBe("pending");
    expect(act.action_type).toBe("activate_systemmind_automation");

    const gate = await getTestGateForSessionServer({ workspaceId: WS2, sessionId: SESSION2 });
    expect(gate.status).toBe("not_tested");
  });

  it("blocks a duplicate pending request for the same session", async () => {
    const { requestTestOverrideApprovalServer } = await import("@/lib/systemmind/build-workspace-testcall.server");
    await expect(
      requestTestOverrideApprovalServer({ workspaceId: WS2, userId: OWNER, sessionId: SESSION2, reason: "duplicate" }),
    ).rejects.toThrow(/already waiting/i);
  });

  it("HiveMind approval activates the override and opens the gate", async () => {
    const { activateSystemMindAutomation } = await import("@/lib/systemmind/systemmind-automation.server");
    const result = await activateSystemMindAutomation(WS2, hubId, "e2e");
    expect(result.draft_id).toBe(hubId);

    const gate = await getTestGateForSessionServer({ workspaceId: WS2, sessionId: SESSION2 });
    expect(gate.status).toBe("passed");
    expect(gate.latest.is_manual_override).toBe(true);
    expect(String(gate.latest.diagnosis)).toMatch(/Approved by HiveMind/);
  });

  it("stale approval cannot pass a newer version (version-binding)", async () => {
    const { requestTestOverrideApprovalServer } = await import("@/lib/systemmind/build-workspace-testcall.server");
    const { activateSystemMindAutomation } = await import("@/lib/systemmind/systemmind-automation.server");

    // Request a manual pass for the CURRENT version (v2 of a fresh session state)…
    const { data: v1 } = await sb.from("systemmind_build_versions")
      .select("id").eq("workspace_id", WS2).eq("session_id", SESSION2).single();
    // clear the earlier passed override so the gate is closed again for a new version
    const { data: v2 } = await sb.from("systemmind_build_versions")
      .insert({ session_id: SESSION2, workspace_id: WS2, created_by_user_id: OWNER, version_number: 2, user_prompt: "e2e v2", assistant_summary: "e2e v2", generated_config: CONFIG, risk_level: "low", risk_reasons: [], status: "applied" })
      .select("id").single();
    await sb.from("systemmind_build_sessions").update({ current_version_id: v2.id }).eq("id", SESSION2);

    const res = await requestTestOverrideApprovalServer({ workspaceId: WS2, userId: OWNER, sessionId: SESSION2, reason: "e2e stale-version request" });

    // …then a NEWER version lands before HiveMind approves.
    const { data: v3 } = await sb.from("systemmind_build_versions")
      .insert({ session_id: SESSION2, workspace_id: WS2, created_by_user_id: OWNER, version_number: 3, user_prompt: "e2e v3", assistant_summary: "e2e v3", generated_config: CONFIG, risk_level: "low", risk_reasons: [], status: "applied" })
      .select("id").single();
    await sb.from("systemmind_build_sessions").update({ current_version_id: v3.id }).eq("id", SESSION2);

    // Approving the stale request must FAIL and must not open the gate for v3.
    await expect(activateSystemMindAutomation(WS2, res.hubActionId, "e2e")).rejects.toThrow(/older build version/i);
    const gate = await getTestGateForSessionServer({ workspaceId: WS2, sessionId: SESSION2, versionId: v3.id });
    expect(gate.status).toBe("not_tested");
    expect(v1.id).toBeTruthy();
  });
});
