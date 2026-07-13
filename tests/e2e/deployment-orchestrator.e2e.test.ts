/**
 * E2E tests for the SystemMind Deployment Orchestrator.
 *
 * Covers: WBAH hard-block, deployment get-or-create idempotency, the 14-item
 * live-recomputed checklist (statuses, overrides whitelist, EL-native path,
 * custom-workflow requirements, telephony skip, test-call gating, number
 * conflicts + same-workspace-only isolation), the approval lifecycle
 * (request dedup, credential scrubbing, decide, atomic single-use consume,
 * TOCTOU re-validation, build-linked go_live block), listing scope, pause /
 * reactivate rules, snapshot persistence and audit rows.
 *
 * NEVER calls Retell purchase/assign/import/go-live provider APIs — every
 * executor test exercises a guard path that throws BEFORE the provider call.
 *
 * Runs against the REAL shared Supabase database (service role) using
 * throw-away workspaces, and cleans up everything it creates.
 *
 * Run: npx vitest run --config vitest.e2e.config.ts tests/e2e/deployment-orchestrator.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  assertNotWbahForDeployment,
  getOrCreateDeploymentServer,
  computeDeploymentChecklistServer,
  setChecklistOverrideServer,
  setDeploymentActiveServer,
  listDeploymentsServer,
  detectNumberConflictServer,
  requestDeploymentApprovalServer,
  decideDeploymentApprovalServer,
  executeApprovedDeploymentActionServer,
} from "@/lib/systemmind/deployment-orchestrator.server";

const sb = supabaseAdmin as any;
const WS = randomUUID();
const OTHER_WS = randomUUID();
const WBAH_WS = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";
let OWNER = "";
let AGENT_A = ""; // bare agent (no settings)
let AGENT_B = ""; // fully-ready agent (retell id + type + number + test passed)
let AGENT_C = ""; // conflict agent (same number as B)
let AGENT_EL = ""; // ElevenLabs-native agent
let AGENT_CUSTOM = ""; // custom-workflow agent
let AGENT_OTHER = ""; // agent in OTHER_WS
const CONFLICT_NUMBER = "+15559990001";

async function insertAgent(ws: string, name: string, settings: Record<string, unknown>) {
  const { data, error } = await sb
    .from("agents")
    .insert({ workspace_id: ws, user_id: OWNER, name, settings })
    .select("id")
    .single();
  if (error) throw new Error(`agent fixture: ${error.message}`);
  return data.id as string;
}

beforeAll(async () => {
  const { data: anyWs } = await sb.from("workspaces").select("owner_id").limit(1).single();
  OWNER = anyWs.owner_id as string;
  for (const [id, name] of [
    [WS, "e2e deploy-orch ws"],
    [OTHER_WS, "e2e deploy-orch other ws"],
  ]) {
    const { error } = await sb.from("workspaces").insert({
      id,
      name,
      owner_id: OWNER,
      slug: `e2e-dor-${(id as string).slice(0, 8)}`,
    });
    if (error) throw new Error(`workspace fixture: ${error.message}`);
  }
  AGENT_A = await insertAgent(WS, "e2e bare agent", {});
  AGENT_B = await insertAgent(WS, "e2e ready agent", {
    deployedRetellAgentId: "agent_e2e_fake_ready",
    dashboardAgentType: "receptionist",
    phoneNumber: null,
  });
  AGENT_C = await insertAgent(WS, "e2e conflict agent", {
    deployedRetellAgentId: "agent_e2e_fake_conflict",
    phoneNumber: CONFLICT_NUMBER,
  });
  AGENT_EL = await insertAgent(WS, "e2e el-native agent", {
    deploymentMode: "ELEVENLABS_NATIVE",
    deployedElevenLabsAgentId: "el_e2e_fake",
    dashboardAgentType: "receptionist",
  });
  AGENT_CUSTOM = await insertAgent(WS, "e2e custom agent", {
    deployedRetellAgentId: "agent_e2e_fake_custom",
    dashboardAgentType: "custom",
    agentType: "custom",
  });
  AGENT_OTHER = await insertAgent(OTHER_WS, "e2e other-ws agent", {});
});

afterAll(async () => {
  for (const ws of [WS, OTHER_WS]) {
    await sb.from("systemmind_deployment_approvals").delete().eq("workspace_id", ws);
    await sb.from("systemmind_deployments").delete().eq("workspace_id", ws);
    await sb.from("systemmind_audit_logs").delete().eq("workspace_id", ws);
    await sb.from("systemmind_usage_events").delete().eq("workspace_id", ws);
    await sb.from("provider_usage_log").delete().eq("workspace_id", ws);
    await sb.from("custom_agent_configs").delete().eq("workspace_id", ws);
    await sb.from("agents").delete().eq("workspace_id", ws);
    await sb.from("workspaces").delete().eq("id", ws);
  }
});

async function dep(agentId: string, deploymentType?: any) {
  const r = await getOrCreateDeploymentServer({
    workspaceId: WS,
    userId: OWNER,
    agentId,
    deploymentType,
  });
  return r.deploymentId;
}

// ── WBAH isolation ─────────────────────────────────────────────────────────────

describe("WBAH hard block", () => {
  it("1. blocks every orchestrator entry point for the WBAH workspace", async () => {
    await expect(assertNotWbahForDeployment(WBAH_WS)).rejects.toThrow();
    await expect(
      getOrCreateDeploymentServer({ workspaceId: WBAH_WS, userId: OWNER, agentId: AGENT_A }),
    ).rejects.toThrow();
    await expect(
      requestDeploymentApprovalServer({
        workspaceId: WBAH_WS,
        userId: OWNER,
        deploymentId: randomUUID(),
        actionType: "go_live",
        payload: {},
      }),
    ).rejects.toThrow();
    await expect(
      executeApprovedDeploymentActionServer({
        supabase: sb,
        workspaceId: WBAH_WS,
        userId: OWNER,
        approvalId: randomUUID(),
      }),
    ).rejects.toThrow();
  });

  it("2. does not block a normal workspace", async () => {
    await expect(assertNotWbahForDeployment(WS)).resolves.toBeUndefined();
  });
});

// ── Deployment lifecycle ───────────────────────────────────────────────────────

describe("getOrCreateDeployment", () => {
  it("3. creates once, then reuses the non-abandoned deployment", async () => {
    const first = await getOrCreateDeploymentServer({ workspaceId: WS, userId: OWNER, agentId: AGENT_A });
    expect(first.created).toBe(true);
    const second = await getOrCreateDeploymentServer({ workspaceId: WS, userId: OWNER, agentId: AGENT_A });
    expect(second.created).toBe(false);
    expect(second.deploymentId).toBe(first.deploymentId);
  });

  it("4. refuses an agent from another workspace (isolation)", async () => {
    await expect(
      getOrCreateDeploymentServer({ workspaceId: WS, userId: OWNER, agentId: AGENT_OTHER }),
    ).rejects.toThrow();
  });

  it("5. writes a deployment_started audit row", async () => {
    const { data } = await sb
      .from("systemmind_audit_logs")
      .select("id")
      .eq("workspace_id", WS)
      .eq("action_type", "deployment_started")
      .limit(1);
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});

// ── Checklist detection ────────────────────────────────────────────────────────

describe("checklist detection", () => {
  it("6. bare agent: 14 items, retell mapping missing, not go-live ready, snapshot persisted", async () => {
    const id = await dep(AGENT_A);
    const cl = await computeDeploymentChecklistServer({ workspaceId: WS, deploymentId: id });
    expect(cl.items.length).toBe(14);
    const byKey = Object.fromEntries(cl.items.map((i) => [i.key, i]));
    expect(byKey.agent_created.status).toBe("complete");
    expect(byKey.retell_agent_mapped.status).toBe("missing");
    expect(byKey.agent_type_selected.status).toBe("missing");
    expect(["missing", "blocked"]).toContain(byKey.number_selected.status);
    expect(byKey.go_live_ready.status).toBe("blocked");
    expect(byKey.go_live.status).toBe("blocked");
    expect(cl.goLiveReady).toBe(false);
    expect(cl.blockers.length).toBeGreaterThan(0);
    // Snapshot persisted on the row (display only)
    const { data: row } = await sb
      .from("systemmind_deployments")
      .select("status, report")
      .eq("id", id)
      .single();
    expect(["blocked", "in_progress"]).toContain(row.status);
    expect(row.report?.items?.length).toBe(14);
    expect(row.report?.go_live_ready).toBe(false);
  });

  it("7. override whitelist: unknown keys are dropped, known keys persist", async () => {
    const id = await dep(AGENT_A);
    await setChecklistOverrideServer({
      workspaceId: WS,
      userId: OWNER,
      deploymentId: id,
      overrides: { test_call: "skipped", evil_key: "x" } as any,
    });
    const { data: row } = await sb
      .from("systemmind_deployments")
      .select("checklist_overrides")
      .eq("id", id)
      .single();
    expect(row.checklist_overrides.test_call).toBe("skipped");
    expect(row.checklist_overrides.evil_key).toBeUndefined();
  });

  it("8. telephony skip: number items optional + warning surfaced", async () => {
    const id = await dep(AGENT_A);
    await setChecklistOverrideServer({
      workspaceId: WS,
      userId: OWNER,
      deploymentId: id,
      overrides: { telephony_path: "skip" },
    });
    const cl = await computeDeploymentChecklistServer({ workspaceId: WS, deploymentId: id });
    const byKey = Object.fromEntries(cl.items.map((i) => [i.key, i]));
    expect(byKey.number_or_sip_required.status).toBe("optional");
    expect(byKey.number_selected.status).toBe("optional");
    expect(cl.warnings.some((w) => w.toLowerCase().includes("skipped"))).toBe(true);
  });

  it("9. failed test call blocks Go Live; passed test completes the item", async () => {
    const id = await dep(AGENT_B);
    await setChecklistOverrideServer({
      workspaceId: WS,
      userId: OWNER,
      deploymentId: id,
      overrides: { telephony_path: "skip", test_call: "failed" },
    });
    let cl = await computeDeploymentChecklistServer({ workspaceId: WS, deploymentId: id });
    let byKey = Object.fromEntries(cl.items.map((i) => [i.key, i]));
    expect(byKey.test_call_passed.status).toBe("failed");
    expect(cl.goLiveReady).toBe(false);
    expect(cl.blockers.some((b) => b.toLowerCase().includes("test call"))).toBe(true);

    await setChecklistOverrideServer({
      workspaceId: WS,
      userId: OWNER,
      deploymentId: id,
      overrides: { test_call: "passed" },
    });
    cl = await computeDeploymentChecklistServer({ workspaceId: WS, deploymentId: id });
    byKey = Object.fromEntries(cl.items.map((i) => [i.key, i]));
    expect(byKey.test_call_passed.status).toBe("complete");
  });

  it("10. ready agent (skip telephony + test passed) becomes go-live ready with approval needed", async () => {
    const id = await dep(AGENT_B);
    const cl = await computeDeploymentChecklistServer({ workspaceId: WS, deploymentId: id });
    const byKey = Object.fromEntries(cl.items.map((i) => [i.key, i]));
    expect(byKey.retell_agent_mapped.status).toBe("complete");
    expect(byKey.agent_type_selected.status).toBe("complete");
    expect(cl.goLiveReady).toBe(true);
    expect(byKey.go_live_ready.status).toBe("complete");
    expect(byKey.approval_required.status).toBe("needs_approval");
    expect(byKey.go_live.status).toBe("blocked"); // approval not yet granted
    const { data: row } = await sb
      .from("systemmind_deployments")
      .select("status")
      .eq("id", id)
      .single();
    expect(row.status).toBe("ready");
  });

  it("11. EL-native agent: no Retell mapping required, number optional", async () => {
    const id = await dep(AGENT_EL);
    const cl = await computeDeploymentChecklistServer({ workspaceId: WS, deploymentId: id });
    const byKey = Object.fromEntries(cl.items.map((i) => [i.key, i]));
    expect(byKey.retell_agent_mapped.status).toBe("complete");
    expect(byKey.number_or_sip_required.status).toBe("optional");
    expect(byKey.number_selected.status).toBe("optional");
  });

  it("12. custom-workflow deployment requires workflow/extraction/CRM items", async () => {
    const id = await dep(AGENT_CUSTOM, "custom_workflow");
    let cl = await computeDeploymentChecklistServer({ workspaceId: WS, deploymentId: id });
    let byKey = Object.fromEntries(cl.items.map((i) => [i.key, i]));
    expect(byKey.workflow_generated.status).toBe("missing");
    expect(byKey.post_call_extraction.status).toBe("missing");
    expect(byKey.crm_mapping.status).toBe("missing");
    expect(cl.goLiveReady).toBe(false);

    // Add a custom config with extraction + CRM mapping → items complete.
    const { error: cfgErr } = await sb.from("custom_agent_configs").insert({
      workspace_id: WS,
      agent_id: AGENT_CUSTOM,
      title: "e2e custom config",
      crm_mode: "standard",
      extraction_fields: [{ name: "outcome", type: "string" }],
      crm_field_mapping: { outcome: "lead.status" },
    });
    expect(cfgErr?.message).toBeUndefined();
    cl = await computeDeploymentChecklistServer({ workspaceId: WS, deploymentId: id });
    byKey = Object.fromEntries(cl.items.map((i) => [i.key, i]));
    expect(byKey.workflow_generated.status).toBe("complete");
    expect(byKey.post_call_extraction.status).toBe("complete");
    expect(byKey.crm_mapping.status).toBe("complete");
  });

  it("13. number conflict detected in-workspace, invisible cross-workspace", async () => {
    const conflict = await detectNumberConflictServer({
      workspaceId: WS,
      phoneNumber: CONFLICT_NUMBER,
      excludeAgentId: AGENT_B,
    });
    expect(conflict?.agentId).toBe(AGENT_C);
    // Same number from another workspace must NOT see the conflict (isolation).
    const crossWs = await detectNumberConflictServer({
      workspaceId: OTHER_WS,
      phoneNumber: CONFLICT_NUMBER,
      excludeAgentId: AGENT_OTHER,
    });
    expect(crossWs).toBeNull();
  });

  it("14. assigned conflicting number blocks Go Live with a warning", async () => {
    await sb
      .from("agents")
      .update({
        settings: {
          deployedRetellAgentId: "agent_e2e_fake_ready",
          dashboardAgentType: "receptionist",
          phoneNumber: CONFLICT_NUMBER,
        },
      })
      .eq("id", AGENT_B);
    const id = await dep(AGENT_B);
    const cl = await computeDeploymentChecklistServer({ workspaceId: WS, deploymentId: id });
    expect(cl.numberConflict?.agentId).toBe(AGENT_C);
    expect(cl.goLiveReady).toBe(false);
    expect(cl.blockers.some((b) => b.includes("conflict") || b.includes(CONFLICT_NUMBER))).toBe(true);
    // restore: number back off agent B
    await sb
      .from("agents")
      .update({
        settings: {
          deployedRetellAgentId: "agent_e2e_fake_ready",
          dashboardAgentType: "receptionist",
          phoneNumber: null,
        },
      })
      .eq("id", AGENT_B);
  });
});

// ── Approvals ──────────────────────────────────────────────────────────────────

describe("approval lifecycle", () => {
  it("15. request creates a pending row with billing warning; duplicate request dedupes", async () => {
    const id = await dep(AGENT_B);
    const first = await requestDeploymentApprovalServer({
      workspaceId: WS,
      userId: OWNER,
      deploymentId: id,
      actionType: "purchase_number",
      payload: { area_code: 415, estimated_cost_usd: 2 },
    });
    const second = await requestDeploymentApprovalServer({
      workspaceId: WS,
      userId: OWNER,
      deploymentId: id,
      actionType: "purchase_number",
      payload: { area_code: 628 },
    });
    expect(second.approvalId).toBe(first.approvalId);
    const { data: row } = await sb
      .from("systemmind_deployment_approvals")
      .select("status, payload")
      .eq("id", first.approvalId)
      .single();
    expect(row.status).toBe("pending");
    expect(String(row.payload.billing_warning ?? "")).toMatch(/cost/i);
    expect(row.payload.workspace_id).toBe(WS);
  });

  it("16. credential-looking payloads are rejected; sip passwords are stripped before persist", async () => {
    const id = await dep(AGENT_B);
    // Retell-style key must be caught by the credential scrubber.
    await expect(
      requestDeploymentApprovalServer({
        workspaceId: WS,
        userId: OWNER,
        deploymentId: id,
        actionType: "import_sip",
        payload: { termination_uri: "sip:x", api_key: "key_1234567890abcdef1234567890abcdef" },
      }),
    ).rejects.toThrow();
    // OpenAI-style key too.
    await expect(
      requestDeploymentApprovalServer({
        workspaceId: WS,
        userId: OWNER,
        deploymentId: id,
        actionType: "import_sip",
        payload: { termination_uri: "sip:x", api_key: "sk-abcdefghijklmnopqrstuvwxyz123456" },
      }),
    ).rejects.toThrow();
    // sip_password (arbitrary string) is stripped, never persisted.
    const { approvalId } = await requestDeploymentApprovalServer({
      workspaceId: WS,
      userId: OWNER,
      deploymentId: id,
      actionType: "import_sip",
      payload: { termination_uri: "sip:x", sip_username: "u1", sip_password: "hunter2-plain" },
    });
    const { data: row } = await sb
      .from("systemmind_deployment_approvals")
      .select("payload")
      .eq("id", approvalId)
      .single();
    expect(row.payload.sip_password).toBeUndefined();
    expect(row.payload.sip_username).toBe("u1");
    expect(JSON.stringify(row.payload)).not.toContain("hunter2-plain");
  });

  it("17. unapproved (pending) approval cannot be executed; rejected cannot either", async () => {
    const id = await dep(AGENT_B);
    const { data: pending } = await sb
      .from("systemmind_deployment_approvals")
      .select("id")
      .eq("deployment_id", id)
      .eq("action_type", "purchase_number")
      .eq("status", "pending")
      .single();
    await expect(
      executeApprovedDeploymentActionServer({
        supabase: sb,
        workspaceId: WS,
        userId: OWNER,
        approvalId: pending.id,
      }),
    ).rejects.toThrow(/not approved/i);
    // Reject it, then decide again must fail (no longer pending).
    await decideDeploymentApprovalServer({
      workspaceId: WS,
      userId: OWNER,
      approvalId: pending.id,
      approve: false,
    });
    await expect(
      decideDeploymentApprovalServer({ workspaceId: WS, userId: OWNER, approvalId: pending.id, approve: true }),
    ).rejects.toThrow();
    await expect(
      executeApprovedDeploymentActionServer({
        supabase: sb,
        workspaceId: WS,
        userId: OWNER,
        approvalId: pending.id,
      }),
    ).rejects.toThrow(/not approved/i);
  });

  it("18. approval from another workspace cannot be decided or executed (isolation)", async () => {
    const id = await dep(AGENT_B);
    const { approvalId } = await requestDeploymentApprovalServer({
      workspaceId: WS,
      userId: OWNER,
      deploymentId: id,
      actionType: "assign_number",
      payload: { phone_number: "+15550001111" },
    });
    await expect(
      decideDeploymentApprovalServer({ workspaceId: OTHER_WS, userId: OWNER, approvalId, approve: true }),
    ).rejects.toThrow();
    await expect(
      executeApprovedDeploymentActionServer({
        supabase: sb,
        workspaceId: OTHER_WS,
        userId: OWNER,
        approvalId,
      }),
    ).rejects.toThrow();
  });

  it("19. approved assign with a stolen-number conflict fails AFTER consume, marks approval failed, single-use", async () => {
    const id = await dep(AGENT_B);
    const { approvalId } = await requestDeploymentApprovalServer({
      workspaceId: WS,
      userId: OWNER,
      deploymentId: id,
      actionType: "assign_number",
      payload: { phone_number: CONFLICT_NUMBER },
    });
    // (may dedupe onto the previous assign_number approval — update payload to the conflict number)
    await sb
      .from("systemmind_deployment_approvals")
      .update({ payload: { phone_number: CONFLICT_NUMBER } })
      .eq("id", approvalId);
    await decideDeploymentApprovalServer({ workspaceId: WS, userId: OWNER, approvalId, approve: true });
    await expect(
      executeApprovedDeploymentActionServer({ supabase: sb, workspaceId: WS, userId: OWNER, approvalId }),
    ).rejects.toThrow(/already assigned/i);
    const { data: row } = await sb
      .from("systemmind_deployment_approvals")
      .select("status, consumed_at, error")
      .eq("id", approvalId)
      .single();
    expect(row.status).toBe("failed");
    expect(row.consumed_at).not.toBeNull();
    expect(String(row.error ?? "")).toMatch(/already assigned/i);
    // Single-use: a second execute cannot run it again.
    await expect(
      executeApprovedDeploymentActionServer({ supabase: sb, workspaceId: WS, userId: OWNER, approvalId }),
    ).rejects.toThrow(/not approved/i);
    // Audit trail recorded the failure.
    const { data: audits } = await sb
      .from("systemmind_audit_logs")
      .select("id")
      .eq("workspace_id", WS)
      .eq("action_type", "deployment_execute_failed:assign_number")
      .limit(1);
    expect((audits ?? []).length).toBeGreaterThan(0);
  });

  it("20. approved go_live on a NOT-ready deployment fails re-validation after consume (agent never goes live)", async () => {
    const id = await dep(AGENT_A); // bare agent — never ready
    const { approvalId } = await requestDeploymentApprovalServer({
      workspaceId: WS,
      userId: OWNER,
      deploymentId: id,
      actionType: "go_live",
      payload: {},
    });
    await decideDeploymentApprovalServer({ workspaceId: WS, userId: OWNER, approvalId, approve: true });
    await expect(
      executeApprovedDeploymentActionServer({ supabase: sb, workspaceId: WS, userId: OWNER, approvalId }),
    ).rejects.toThrow(/blocked/i);
    const { data: agent } = await sb.from("agents").select("settings").eq("id", AGENT_A).single();
    expect(agent.settings?.isLive).not.toBe(true);
  });

  it("21. build-linked deployment refuses go_live approval requests (Build Workspace path only)", async () => {
    const id = await dep(AGENT_B);
    await sb
      .from("systemmind_deployments")
      .update({ build_version_id: randomUUID() })
      .eq("id", id)
      .eq("workspace_id", WS);
    await expect(
      requestDeploymentApprovalServer({
        workspaceId: WS,
        userId: OWNER,
        deploymentId: id,
        actionType: "go_live",
        payload: {},
      }),
    ).rejects.toThrow(/Build Workspace/i);
    const cl = await computeDeploymentChecklistServer({ workspaceId: WS, deploymentId: id });
    const goLive = cl.items.find((i) => i.key === "go_live")!;
    expect(goLive.status).toBe("blocked");
    expect(goLive.action).toBe("open_build_workspace");
    await sb
      .from("systemmind_deployments")
      .update({ build_version_id: null })
      .eq("id", id)
      .eq("workspace_id", WS);
  });
});

// ── Listing + pause/reactivate ────────────────────────────────────────────────

describe("listing and lifecycle controls", () => {
  it("22. listDeployments is workspace-scoped", async () => {
    const mine = await listDeploymentsServer({ workspaceId: WS });
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((d) => d.workspace_id === WS)).toBe(true);
    const other = await listDeploymentsServer({ workspaceId: OTHER_WS });
    expect(other.every((d) => d.workspace_id === OTHER_WS)).toBe(true);
    expect(other.some((d) => d.agent_id === AGENT_A)).toBe(false);
  });

  it("23. pause → abandoned, reactivate → in_progress; pausing a live deployment refuses", async () => {
    const id = await dep(AGENT_EL);
    await setDeploymentActiveServer({ workspaceId: WS, userId: OWNER, deploymentId: id, active: false });
    let { data: row } = await sb.from("systemmind_deployments").select("status").eq("id", id).single();
    expect(row.status).toBe("abandoned");
    await setDeploymentActiveServer({ workspaceId: WS, userId: OWNER, deploymentId: id, active: true });
    ({ data: row } = await sb.from("systemmind_deployments").select("status").eq("id", id).single());
    expect(row.status).toBe("in_progress");
    // Force live and try to pause.
    await sb.from("systemmind_deployments").update({ status: "live" }).eq("id", id);
    await expect(
      setDeploymentActiveServer({ workspaceId: WS, userId: OWNER, deploymentId: id, active: false }),
    ).rejects.toThrow(/live/i);
    await sb.from("systemmind_deployments").update({ status: "in_progress" }).eq("id", id);
  });

  it("24. cost + usage events recorded for executor runs (failure path records usage too)", async () => {
    // Test 19/20 executed failing actions — usage events must exist for AccountsMind.
    await new Promise((r) => setTimeout(r, 1500)); // fire-and-forget insert settle
    const { data } = await sb
      .from("systemmind_usage_events")
      .select("task_type, success")
      .eq("workspace_id", WS);
    const kinds = new Set((data ?? []).map((e: any) => e.task_type));
    expect(kinds.has("deployment_assign_number") || kinds.has("deployment_go_live")).toBe(true);
  });
});
