/**
 * E2E tests for Task #460: SystemMind setup wizard, testing, versioning,
 * activation gate + logged admin override, state management (pause/resume/
 * rollback), health, call triggers and queue control.
 *
 * Runs against the REAL shared Supabase database (service role) using
 * throw-away workspaces and cleans everything up.
 *
 * Run: npx vitest run --config vitest.e2e.config.ts tests/e2e/call-workflow-wizard.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  computeWizardStatus,
  runWorkflowTestsServer,
  getOrCreateDraftActivationServer,
  activateWorkflowServer,
  setWorkflowStateServer,
  getWorkflowHealthServer,
} from "@/lib/systemmind/call-runtime/setup-wizard.server";
import {
  saveCallTriggerServer,
  setTriggerEnabledServer,
} from "@/lib/systemmind/call-runtime/triggers.server";
import { enqueueCall, controlQueueEntryServer } from "@/lib/systemmind/call-runtime/queue.server";

const sb = supabaseAdmin as any;
const WS = randomUUID();
const OTHER_WS = randomUUID();
const WBAH_WORKSPACE_ID = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";
let OWNER_ID = "";
let AGENT_ID = "";
let LEAD_ID = "";
let memberRowInserted = false;

beforeAll(async () => {
  const { data: anyWs } = await sb.from("workspaces").select("owner_id").limit(1).single();
  OWNER_ID = anyWs.owner_id as string;
  for (const [id, name] of [[WS, "e2e wizard ws"], [OTHER_WS, "e2e wizard other ws"]]) {
    const { error } = await sb.from("workspaces").insert({
      id, name, owner_id: OWNER_ID, slug: `e2e-wiz-${String(id).slice(0, 8)}`,
    });
    if (error) throw new Error(`workspace fixture: ${error.message}`);
  }
  const { error: mErr } = await sb.from("workspace_members").insert({
    workspace_id: WS, user_id: OWNER_ID, role: "owner",
  });
  if (!mErr) memberRowInserted = true;

  // Entitlement fixture: activation checks page access, which requires a
  // package with the systemmind department.
  const { PACKAGE_CATALOG } = await import("@/lib/packages/packages.shared");
  const full = PACKAGE_CATALOG.find((p: any) => p.aiDepartments?.includes("systemmind"));
  if (!full) throw new Error("No package with systemmind department in catalog");
  const { error: subErr } = await sb.from("workspace_subscriptions").insert({
    workspace_id: WS, package_key: (full as any).packageKey, subscription_status: "active",
  });
  if (subErr) throw new Error(`subscription fixture: ${subErr.message}`);
  const { invalidateEntitlementsCache } = await import("@/lib/packages/entitlements.server");
  invalidateEntitlementsCache(WS);

  const { data: agent, error: aErr } = await sb.from("agents").insert({
    workspace_id: WS, user_id: OWNER_ID, name: "e2e wizard agent",
    settings: {
      agentType: "client_qualification", channelType: "voice",
      globalPrompt: "Greet {{first_name}} and confirm {{phone_number}}.",
    },
    flow_data: { nodes: [], edges: [] },
  }).select("id").single();
  if (aErr) throw new Error(`agent fixture: ${aErr.message}`);
  AGENT_ID = agent.id as string;

  const { data: lead, error: lErr } = await sb.from("leads").insert({
    workspace_id: WS, full_name: "E2E Wizard Lead", phone: "+447700900999",
    source: "website_form", status: "need_to_call",
  }).select("id").single();
  if (lErr) throw new Error(`lead fixture: ${lErr.message}`);
  LEAD_ID = lead.id as string;
}, 60000);

afterAll(async () => {
  for (const ws of [WS, OTHER_WS]) {
    for (const table of [
      "systemmind_execution_steps", "systemmind_workflow_executions",
      "systemmind_call_attempts", "systemmind_call_queue",
      "systemmind_call_triggers", "systemmind_integration_errors",
      "systemmind_workflow_activations", "systemmind_audit_logs",
      "workspace_subscriptions", "leads", "agents",
    ]) {
      await sb.from(table).delete().eq("workspace_id", ws);
    }
    if (memberRowInserted) {
      await sb.from("workspace_members").delete().eq("workspace_id", ws).eq("user_id", OWNER_ID);
    }
    await sb.from("workspaces").delete().eq("id", ws);
  }
}, 60000);

describe("wizard status", () => {
  it("computes all 14 evidence-based steps", async () => {
    const { steps } = await computeWizardStatus({ workspaceId: WS, agentId: AGENT_ID });
    expect(steps.length).toBe(14);
    for (const s of steps) {
      expect(typeof s.key).toBe("string");
      expect(typeof s.label).toBe("string");
      expect(Array.isArray(s.evidence)).toBe(true);
      expect(typeof s.status).toBe("string");
    }
    const keys = steps.map((s: any) => s.key);
    expect(keys).toContain("call_trigger");
    expect(keys).toContain("call_queue");
    expect(keys).toContain("test_workflow");
    expect(keys).toContain("activate");
  });

  it("hard-blocks the WBAH workspace", async () => {
    await expect(computeWizardStatus({ workspaceId: WBAH_WORKSPACE_ID, agentId: null }))
      .rejects.toThrow();
  });
});

describe("versioning, test gate, override, state", () => {
  let draftId = "";

  it("creates a v1 draft and is idempotent", async () => {
    const draft = await getOrCreateDraftActivationServer({
      workspaceId: WS, userId: OWNER_ID, agentId: AGENT_ID,
    });
    expect(draft.version_number).toBe(1);
    expect(draft.status).toBe("draft");
    draftId = draft.id;
    const again = await getOrCreateDraftActivationServer({
      workspaceId: WS, userId: OWNER_ID, agentId: AGENT_ID,
    });
    expect(again.id).toBe(draftId);
  });

  it("runs the 12-check test suite and stores results", async () => {
    const res = await runWorkflowTestsServer({
      workspaceId: WS, userId: OWNER_ID, activationId: draftId,
    });
    expect(res.checks.length).toBe(12);
    for (const c of res.checks) {
      expect(typeof c.key).toBe("string");
      expect(typeof c.ok).toBe("boolean");
      expect(typeof c.critical).toBe("boolean");
      expect(typeof c.detail).toBe("string");
    }
    const { data: row } = await sb
      .from("systemmind_workflow_activations")
      .select("test_results, test_passed")
      .eq("id", draftId).single();
    expect(row.test_results?.checks?.length).toBe(12);
    expect(row.test_results?.ranAt).toBeTruthy();
    expect(typeof row.test_passed).toBe("boolean");
  });

  it("blocks activation without passing tests and without a reason", async () => {
    // Force a failed test state so the gate is deterministic.
    await sb.from("systemmind_workflow_activations")
      .update({ test_passed: false }).eq("id", draftId);
    const res = await activateWorkflowServer({
      workspaceId: WS, userId: OWNER_ID, activationId: draftId,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("tests_not_passed");
  });

  it("allows an owner override WITH a reason and writes the audit log", async () => {
    const res = await activateWorkflowServer({
      workspaceId: WS, userId: OWNER_ID, activationId: draftId,
      adminOverride: { reason: "e2e override: activating an untested draft deliberately" },
    });
    expect(res.ok).toBe(true);
    expect(res.activation.status).toBe("active");
    const { data: act } = await sb
      .from("systemmind_workflow_activations")
      .select("admin_override, override_reason, override_by_user_id")
      .eq("id", draftId).single();
    expect(act.admin_override).toBe(true);
    expect(act.override_by_user_id).toBe(OWNER_ID);
    const { data: audits } = await sb
      .from("systemmind_audit_logs")
      .select("id, action_type")
      .eq("workspace_id", WS)
      .eq("action_type", "workflow_activation_admin_override");
    expect((audits ?? []).length).toBeGreaterThan(0);
  });

  it("new draft becomes v2 with parent link; activating supersedes v1; rollback restores v1", async () => {
    const v2 = await getOrCreateDraftActivationServer({
      workspaceId: WS, userId: OWNER_ID, agentId: AGENT_ID,
    });
    expect(v2.version_number).toBe(2);
    expect(v2.parent_activation_id).toBe(draftId);

    // pass the test gate honestly for v2
    await sb.from("systemmind_workflow_activations")
      .update({ test_passed: true }).eq("id", v2.id);
    const act = await activateWorkflowServer({
      workspaceId: WS, userId: OWNER_ID, activationId: v2.id,
    });
    expect(act.ok).toBe(true);
    const { data: v1 } = await sb.from("systemmind_workflow_activations")
      .select("status").eq("id", draftId).single();
    expect(v1.status).toBe("superseded");

    // health is computable on the active version
    const health = await getWorkflowHealthServer({ workspaceId: WS, activationId: v2.id });
    expect(typeof health.status).toBe("string");
    expect(Array.isArray(health.checks)).toBe(true);

    // pause → resume
    const pause = await setWorkflowStateServer({ workspaceId: WS, userId: OWNER_ID, activationId: v2.id, action: "pause" });
    expect(pause.ok).toBe(true);
    const resume = await setWorkflowStateServer({ workspaceId: WS, userId: OWNER_ID, activationId: v2.id, action: "resume" });
    expect(resume.ok).toBe(true);

    // rollback to v1
    const rb = await setWorkflowStateServer({ workspaceId: WS, userId: OWNER_ID, activationId: v2.id, action: "rollback" });
    expect(rb.ok).toBe(true);
    const { data: after } = await sb.from("systemmind_workflow_activations")
      .select("id, status").in("id", [draftId, v2.id]);
    const byId = Object.fromEntries((after ?? []).map((r: any) => [r.id, r.status]));
    expect(byId[draftId]).toBe("active");
    expect(byId[v2.id]).toBe("rolled_back");
  });

  it("cross-workspace access is denied", async () => {
    const res = await activateWorkflowServer({
      workspaceId: OTHER_WS, userId: OWNER_ID, activationId: draftId,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("activation_not_found");
    await expect(runWorkflowTestsServer({
      workspaceId: OTHER_WS, userId: OWNER_ID, activationId: draftId,
    })).rejects.toThrow("activation_not_found");
  });
});

describe("triggers and queue", () => {
  let triggerId = "";
  let queueId = "";

  it("saves and toggles a call trigger", async () => {
    const row = await saveCallTriggerServer({
      workspaceId: WS, userId: OWNER_ID, agentId: AGENT_ID,
      name: "e2e new-lead trigger", triggerType: "webee_lead_created" as any,
      enabled: true, dailyCap: 50,
      callingWindow: { start: "09:00", end: "18:00", timezone: "Europe/London" } as any,
    });
    expect(row.id).toBeTruthy();
    expect(row.enabled).toBe(true);
    triggerId = row.id;
    await setTriggerEnabledServer({ workspaceId: WS, id: triggerId, enabled: false });
    const { data: t } = await sb.from("systemmind_call_triggers").select("enabled").eq("id", triggerId).single();
    expect(t.enabled).toBe(false);
  });

  it("enqueues a call and supports pause/resume/cancel control", async () => {
    const entry = await enqueueCall({
      workspaceId: WS, agentId: AGENT_ID, leadId: LEAD_ID,
      triggerId, phone: "+447700900999",
    } as any);
    expect(entry.enqueued).toBe(true);
    expect(entry.queueId).toBeTruthy();
    queueId = entry.queueId!;

    const paused = await controlQueueEntryServer({ workspaceId: WS, queueId, action: "pause" });
    expect(paused.ok).toBe(true);
    const resumed = await controlQueueEntryServer({ workspaceId: WS, queueId, action: "resume" });
    expect(resumed.ok).toBe(true);
    const cancelled = await controlQueueEntryServer({ workspaceId: WS, queueId, action: "cancel" });
    expect(cancelled.ok).toBe(true);
    const { data: q } = await sb.from("systemmind_call_queue").select("status").eq("id", queueId).single();
    expect(q.status).toBe("cancelled");
  });

  it("denies queue control from another workspace", async () => {
    const res = await controlQueueEntryServer({ workspaceId: OTHER_WS, queueId, action: "pause" });
    expect(res.ok).toBe(false);
  });
});
