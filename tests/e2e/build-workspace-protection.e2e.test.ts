/**
 * E2E tests for Task: SystemMind Build Workspace apply-protection rules.
 *
 * Covers: diff computation, variable-reference extraction, impact analysis
 * (conflict detection: live target, removed-but-referenced variables,
 * duplicate triggers, workspace mismatch), rollback snapshots (create +
 * restore), safe apply modes (new_draft never touches the existing target,
 * direct overwrites AFTER a snapshot), and hard blocks on apply/Go Live.
 *
 * Runs against the REAL shared Supabase database (service role) using a
 * throw-away random workspace id (tables have no FK on workspace_id), and
 * cleans up everything it creates.
 *
 * Run: npx vitest run --config vitest.e2e.config.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  computeBuildDiff,
  extractVariableReferences,
  computeBuildImpactReport,
  createBuildSnapshotServer,
  listBuildSnapshotsServer,
  rollbackBuildSnapshotServer,
} from "@/lib/systemmind/build-protection.server";
import {
  applyBuildVersionServer,
  getBuildApplySafetyReportServer,
  rollbackBuildApplyServer,
  type BuildConfig,
} from "@/lib/systemmind/build-workspace.server";

const sb = supabaseAdmin as any;
const WS = randomUUID(); // throw-away workspace — real row created in beforeAll
const OTHER_WS = randomUUID();
let AGENT_ID = ""; // real agents row (custom_agent_configs has FKs on both columns)

beforeAll(async () => {
  // custom_agent_configs FKs on workspace_id → workspaces and agent_id → agents,
  // so we need REAL rows. Borrow an existing owner_id (agents.user_id is NOT NULL).
  const { data: anyWs } = await sb.from("workspaces").select("owner_id").limit(1).single();
  const ownerId = anyWs.owner_id as string;
  for (const [id, name] of [[WS, "e2e build-protection ws"], [OTHER_WS, "e2e build-protection other ws"]]) {
    const { error } = await sb.from("workspaces").insert({
      id, name, owner_id: ownerId, slug: `e2e-bwp-${id.slice(0, 8)}`,
    });
    if (error) throw new Error(`workspace fixture: ${error.message}`);
  }
  const { data: agent, error: aErr } = await sb.from("agents").insert({
    workspace_id: WS, user_id: ownerId, name: "e2e protection agent", settings: {},
  }).select("id").single();
  if (aErr) throw new Error(`agent fixture: ${aErr.message}`);
  AGENT_ID = agent.id as string;
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

function baseConfig(over: Partial<BuildConfig> = {}): BuildConfig {
  return {
    agent_prompt: "You are a helpful booking agent.",
    workflow: {
      name:           "Protection test workflow",
      purpose:        "e2e protection test",
      trigger_type:   "manual",
      trigger_config: {},
      steps: [
        { id: "s1", type: "trigger", next: "s2" },
        { id: "s2", type: "notify_user", title: "Notify the team" },
      ],
    },
    variables:            [],
    extraction_fields:    [],
    follow_up_rules:      [],
    channel_setup:        {},
    required_credentials: [],
    risks:                [],
    test_plan:            [],
    ...over,
  } as BuildConfig;
}

async function insertWorkflow(over: Record<string, any> = {}): Promise<string> {
  const { data, error } = await sb.from("workspace_workflows").insert({
    workspace_id:    WS,
    name:            "Existing workflow",
    trigger_type:    "manual",
    trigger_config:  {},
    flow_definition: { steps: [{ id: "s1", type: "trigger", next: "s2" }, { id: "s2", type: "notify_user", title: "Old notify" }] },
    status:          "inactive",
    ...over,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function insertSession(over: Record<string, any> = {}): Promise<string> {
  const { data, error } = await sb.from("systemmind_build_sessions").insert({
    workspace_id: WS,
    title:        "e2e protection session",
    source_page:  "systemmind",
    status:       "active",
    ...over,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function insertVersion(sessionId: string, config: BuildConfig, over: Record<string, any> = {}): Promise<string> {
  const { data, error } = await sb.from("systemmind_build_versions").insert({
    session_id:       sessionId,
    workspace_id:     WS,
    version_number:   1,
    generated_config: config,
    risk_level:       "low",
    risk_reasons:     [],
    status:           "draft",
    ...over,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function getSessionRow(sessionId: string): Promise<any> {
  const { data } = await sb.from("systemmind_build_sessions").select("*").eq("id", sessionId).single();
  return data;
}

async function getVersionRow(versionId: string): Promise<any> {
  const { data } = await sb.from("systemmind_build_versions").select("*").eq("id", versionId).single();
  return data;
}

afterAll(async () => {
  for (const table of [
    "systemmind_build_snapshots",
    "systemmind_build_messages",
    "systemmind_build_versions",
    "systemmind_build_sessions",
    "systemmind_generated_actions",
    "systemmind_usage_events",
    "systemmind_audit_logs",
    "hivemind_actions",
    "custom_agent_configs",
    "workspace_workflows",
  ]) {
    await sb.from(table).delete().eq("workspace_id", WS);
    await sb.from(table).delete().eq("workspace_id", OTHER_WS);
  }
  await sb.from("agents").delete().eq("workspace_id", WS);
  await sb.from("workspace_members").delete().in("workspace_id", [WS, OTHER_WS]);
  await sb.from("workspaces").delete().in("id", [WS, OTHER_WS]);
});

// ── 1. Diff computation ────────────────────────────────────────────────────────
describe("computeBuildDiff", () => {
  it("reports renames, trigger changes, step add/remove and variable removal", () => {
    const current = {
      name:         "Old name",
      trigger_type: "manual",
      steps:        [{ id: "s1", type: "trigger", next: "s2" }, { id: "s2", type: "notify_user" }, { id: "s3", type: "create_task" }],
      agent_prompt: "Old prompt",
      variables:    [{ name: "budget" }],
      extraction_fields: [],
      follow_up_rules:   [{ trigger: "no answer", action: "retry" }],
    };
    const proposed = baseConfig({
      workflow: {
        name: "New name", purpose: "", trigger_type: "lead_added", trigger_config: {},
        steps: [
          { id: "s1", type: "trigger", next: "s2" },
          { id: "s2", type: "notify_user" },
          { id: "s4", type: "send_email", title: "Send recap" },
        ],
      } as any,
      agent_prompt: "New prompt",
      follow_up_rules: [],
    });
    const diff = computeBuildDiff(current, proposed);
    const kinds = diff.map((d) => `${d.kind}:${d.area}`);
    expect(kinds).toContain("renamed:workflow");
    expect(kinds).toContain("changed:trigger");
    expect(kinds).toContain("added:steps");     // s4
    expect(kinds).toContain("removed:steps");   // s3
    expect(kinds).toContain("changed:agent_prompt");
    expect(kinds).toContain("removed:variables"); // budget
    expect(kinds).toContain("changed:follow_up_rules");
  });

  it("returns an empty diff for identical state", () => {
    const proposed = baseConfig();
    const current = {
      name:              proposed.workflow.name,
      trigger_type:      proposed.workflow.trigger_type,
      steps:             proposed.workflow.steps,
      agent_prompt:      proposed.agent_prompt,
      variables:         [],
      extraction_fields: [],
      follow_up_rules:   [],
    };
    expect(computeBuildDiff(current, proposed)).toHaveLength(0);
  });
});

// ── 2. Variable-reference extraction ───────────────────────────────────────────
describe("extractVariableReferences", () => {
  it("finds {{var}} references in prompt, steps and follow-up rules", () => {
    const cfg = baseConfig({
      agent_prompt: "Greet {{customer_name}} and confirm {{booking.date}}.",
      follow_up_rules: [{ trigger: "no show", action: "message {{customer_name}} about {{reschedule_link}}" }],
    });
    (cfg.workflow.steps as any[]).push({ id: "s3", type: "send_email", title: "Uses {{quote_total}}" });
    const refs = extractVariableReferences(cfg);
    expect(refs.has("customer_name")).toBe(true);
    expect(refs.has("booking")).toBe(true); // dotted refs resolve to root
    expect(refs.has("reschedule_link")).toBe(true);
    expect(refs.has("quote_total")).toBe(true);
  });
});

// ── 3. Impact analysis + conflict detection ────────────────────────────────────
describe("computeBuildImpactReport", () => {
  it("fresh target: nothing existing is touched, direct apply is allowed", async () => {
    const sessionId = await insertSession();
    const session = await getSessionRow(sessionId);
    const impact = await computeBuildImpactReport({
      workspaceId: WS, session, version: { id: randomUUID() },
      config: baseConfig(), riskLevel: "low", riskReasons: [],
    });
    expect(impact.targetIsNew).toBe(true);
    expect(impact.conflicts).toHaveLength(0);
    expect(impact.canApplyDirectly).toBe(true);
    expect(impact.canGoLive).toBe(true);
    expect(impact.rollbackAvailable).toBe(false);
  });

  it("flags an ACTIVE linked workflow as needs_approval (live_target)", async () => {
    const wfId = await insertWorkflow({ status: "active", name: "Live intake flow" });
    const sessionId = await insertSession({ linked_workflow_id: wfId });
    const session = await getSessionRow(sessionId);
    const impact = await computeBuildImpactReport({
      workspaceId: WS, session, version: { id: randomUUID() },
      config: baseConfig(), riskLevel: "low", riskReasons: [],
    });
    expect(impact.targetIsNew).toBe(false);
    expect(impact.targetIsLive).toBe(true);
    const live = impact.conflicts.find((c) => c.code === "live_target");
    expect(live?.severity).toBe("needs_approval");
    expect(impact.requiresApproval).toBe(true);
    expect(impact.canApplyDirectly).toBe(false);
    await sb.from("workspace_workflows").update({ status: "inactive" }).eq("id", wfId);
  });

  it("BLOCKS when the proposal still references a variable it removes", async () => {
    const wfId = await insertWorkflow();
    const { error: cfgErr } = await sb.from("custom_agent_configs").insert({
      workspace_id: WS, agent_id: AGENT_ID, title: "e2e cfg",
      required_variables: [{ name: "budget" }],
      extraction_fields: [], deployment_config: {},
    });
    expect(cfgErr).toBeNull();
    const sessionId = await insertSession({ linked_workflow_id: wfId, target_agent_id: AGENT_ID });
    const session = await getSessionRow(sessionId);
    const cfg = baseConfig({ agent_prompt: "Ask about {{budget}} before booking.", variables: [] });
    const impact = await computeBuildImpactReport({
      workspaceId: WS, session, version: { id: randomUUID() },
      config: cfg, riskLevel: "low", riskReasons: [],
    });
    const broken = impact.conflicts.find((c) => c.code === "referenced_variable_removed");
    expect(broken?.severity).toBe("block");
    expect(impact.canApplyDirectly).toBe(false);
    expect(impact.canGoLive).toBe(false);
  });

  it("duplicate active trigger on a NEW/inactive target blocks Go Live (draft still allowed)", async () => {
    await insertWorkflow({ status: "active", trigger_type: "lead_added", name: "Existing lead-added flow" });
    const sessionId = await insertSession();
    const session = await getSessionRow(sessionId);
    const cfg = baseConfig();
    (cfg.workflow as any).trigger_type = "lead_added";
    const impact = await computeBuildImpactReport({
      workspaceId: WS, session, version: { id: randomUUID() },
      config: cfg, riskLevel: "low", riskReasons: [],
    });
    const dup = impact.conflicts.find((c) => c.code === "duplicate_trigger");
    expect(dup?.severity).toBe("block_go_live");
    expect(impact.canGoLive).toBe(false);
    await sb.from("workspace_workflows").update({ status: "inactive" }).eq("workspace_id", WS).eq("trigger_type", "lead_added");
  });

  it("duplicate trigger HARD-BLOCKS when the overwrite target is itself active", async () => {
    await insertWorkflow({ status: "active", trigger_type: "lead_added", name: "Other active lead-added flow" });
    const targetId = await insertWorkflow({ status: "active", trigger_type: "manual", name: "Active overwrite target" });
    const sessionId = await insertSession({ linked_workflow_id: targetId });
    const session = await getSessionRow(sessionId);
    const cfg = baseConfig();
    (cfg.workflow as any).trigger_type = "lead_added";
    const impact = await computeBuildImpactReport({
      workspaceId: WS, session, version: { id: randomUUID() },
      config: cfg, riskLevel: "low", riskReasons: [],
    });
    const dup = impact.conflicts.find((c) => c.code === "duplicate_trigger");
    expect(dup?.severity).toBe("block");
    expect(impact.canApplyDirectly).toBe(false);
    await sb.from("workspace_workflows").update({ status: "inactive" }).eq("workspace_id", WS).eq("trigger_type", "lead_added");
    await sb.from("workspace_workflows").update({ status: "inactive" }).eq("id", targetId);
  });

  it("flags a LIVE agent as needs_approval (live_agent) — direct overwrite is never silent", async () => {
    await sb.from("agents").update({ settings: { isLive: true } }).eq("id", AGENT_ID);
    try {
      const sessionId = await insertSession({ target_agent_id: AGENT_ID });
      const session = await getSessionRow(sessionId);
      const impact = await computeBuildImpactReport({
        workspaceId: WS, session, version: { id: randomUUID() },
        config: baseConfig(), riskLevel: "low", riskReasons: [],
      });
      expect(impact.agentIsLive).toBe(true);
      const live = impact.conflicts.find((c) => c.code === "live_agent");
      expect(live?.severity).toBe("needs_approval");
      expect(impact.requiresApproval).toBe(true);
      expect(impact.canApplyDirectly).toBe(false);
    } finally {
      await sb.from("agents").update({ settings: {} }).eq("id", AGENT_ID);
    }
  });

  it("BLOCKS a cross-workspace linked workflow (workspace_mismatch)", async () => {
    const { data: foreign, error } = await sb.from("workspace_workflows").insert({
      workspace_id: OTHER_WS, name: "Foreign workflow", trigger_type: "manual",
      flow_definition: { steps: [] }, status: "inactive",
    }).select("id").single();
    expect(error).toBeNull();
    const sessionId = await insertSession({ linked_workflow_id: foreign.id });
    const session = await getSessionRow(sessionId);
    const impact = await computeBuildImpactReport({
      workspaceId: WS, session, version: { id: randomUUID() },
      config: baseConfig(), riskLevel: "low", riskReasons: [],
    });
    const mismatch = impact.conflicts.find((c) => c.code === "workspace_mismatch");
    expect(mismatch?.severity).toBe("block");
  });

  it("blocks Go Live (not the draft) when WhatsApp steps have no provider", async () => {
    const sessionId = await insertSession();
    const session = await getSessionRow(sessionId);
    const cfg = baseConfig();
    (cfg.workflow.steps as any[]).push({ id: "s3", type: "send_whatsapp", title: "WA follow-up" });
    const impact = await computeBuildImpactReport({
      workspaceId: WS, session, version: { id: randomUUID() },
      config: cfg, riskLevel: "low", riskReasons: [],
    });
    const wa = impact.conflicts.find((c) => c.code === "missing_whatsapp_provider");
    expect(wa?.severity).toBe("block_go_live");
    expect(impact.canApplyDirectly).toBe(true); // draft apply still allowed
    expect(impact.canGoLive).toBe(false);
  });
});

// ── 4. Rollback snapshots ──────────────────────────────────────────────────────
describe("rollback snapshots", () => {
  it("returns null when there is nothing to protect", async () => {
    const res = await createBuildSnapshotServer({
      workspaceId: WS, userId: null, sessionId: null, versionId: null,
      versionNumber: null, targetWorkflowId: null, targetAgentId: null,
    });
    expect(res).toBeNull();
  });

  it("snapshots the prior workflow state and restores it after mutation", async () => {
    const wfId = await insertWorkflow({ name: "Snapshot me", description: "original" });
    const sessionId = await insertSession({ linked_workflow_id: wfId });
    const snap = await createBuildSnapshotServer({
      workspaceId: WS, userId: null, sessionId, versionId: null,
      versionNumber: 1, targetWorkflowId: wfId, targetAgentId: null,
    });
    expect(snap?.snapshotId).toBeTruthy();

    // Simulate a bad apply mutating the row.
    await sb.from("workspace_workflows").update({ name: "CLOBBERED", trigger_type: "lead_added" }).eq("id", wfId);

    const result = await rollbackBuildSnapshotServer({ workspaceId: WS, userId: null, snapshotId: snap!.snapshotId });
    expect(result.restoredWorkflowId).toBe(wfId);

    const { data: after } = await sb.from("workspace_workflows").select("name, trigger_type").eq("id", wfId).single();
    expect(after.name).toBe("Snapshot me");
    expect(after.trigger_type).toBe("manual");

    const list = await listBuildSnapshotsServer(WS, sessionId);
    expect(list.find((s: any) => s.id === snap!.snapshotId)?.restored_at).toBeTruthy();
  });

  it("recreates a deleted workflow row with the same id on rollback", async () => {
    const wfId = await insertWorkflow({ name: "Deleted later" });
    const snap = await createBuildSnapshotServer({
      workspaceId: WS, userId: null, sessionId: null, versionId: null,
      versionNumber: null, targetWorkflowId: wfId, targetAgentId: null,
    });
    await sb.from("workspace_workflows").delete().eq("id", wfId);
    const result = await rollbackBuildSnapshotServer({ workspaceId: WS, userId: null, snapshotId: snap!.snapshotId });
    expect(result.restoredWorkflowId).toBe(wfId);
    const { data: after } = await sb.from("workspace_workflows").select("id, name").eq("id", wfId).single();
    expect(after.name).toBe("Deleted later");
  });

  it("refuses rollback of a snapshot from another workspace", async () => {
    const wfId = await insertWorkflow();
    const snap = await createBuildSnapshotServer({
      workspaceId: WS, userId: null, sessionId: null, versionId: null,
      versionNumber: null, targetWorkflowId: wfId, targetAgentId: null,
    });
    await expect(
      rollbackBuildSnapshotServer({ workspaceId: OTHER_WS, userId: null, snapshotId: snap!.snapshotId }),
    ).rejects.toThrow(/not found/i);
  });
});

// ── 5. Apply modes + hard blocks through the REAL apply path ──────────────────
describe("applyBuildVersionServer protection", () => {
  it("new_draft mode creates a separate row and never touches the existing target", async () => {
    const wfId = await insertWorkflow({ name: "Untouchable", status: "inactive" });
    const sessionId = await insertSession({ linked_workflow_id: wfId });
    const versionId = await insertVersion(sessionId, baseConfig({ workflow: {
      name: "Draft variant", purpose: "", trigger_type: "manual", trigger_config: {},
      steps: [{ id: "s1", type: "trigger", next: "s2" }, { id: "s2", type: "create_task", title: "New task step" }],
    } as any }));

    const res = await applyBuildVersionServer({
      workspaceId: WS, userId: null, sessionId, versionId, mode: "new_draft",
    });
    expect(res.requiresApproval).toBe(false);
    expect(res.workflowId).toBeTruthy();
    expect(res.workflowId).not.toBe(wfId);

    const { data: original } = await sb.from("workspace_workflows").select("name").eq("id", wfId).single();
    expect(original.name).toBe("Untouchable"); // untouched

    const { data: draft } = await sb.from("workspace_workflows").select("name, status").eq("id", res.workflowId).single();
    expect(draft.status).toBe("inactive"); // never lands active
  });

  it("direct mode snapshots BEFORE overwriting, and the snapshot restores the old state", async () => {
    const wfId = await insertWorkflow({ name: "Overwrite me", status: "inactive" });
    const sessionId = await insertSession({ linked_workflow_id: wfId });
    const versionId = await insertVersion(sessionId, baseConfig({ workflow: {
      name: "Overwritten name", purpose: "", trigger_type: "manual", trigger_config: {},
      steps: [{ id: "s1", type: "trigger", next: "s2" }, { id: "s2", type: "notify_user", title: "Replacement" }],
    } as any }));

    const res = await applyBuildVersionServer({
      workspaceId: WS, userId: null, sessionId, versionId, mode: "direct",
    });
    expect(res.requiresApproval).toBe(false);
    expect(res.workflowId).toBe(wfId);
    expect(res.snapshotId).toBeTruthy();

    const { data: after } = await sb.from("workspace_workflows").select("name").eq("id", wfId).single();
    expect(after.name).toBe("Overwritten name");

    // One-call rollback through the session-scoped wrapper.
    const rb = await rollbackBuildApplyServer({ workspaceId: WS, userId: null, sessionId, snapshotId: res.snapshotId! });
    expect(rb.restoredWorkflowId).toBe(wfId);
    const { data: restored } = await sb.from("workspace_workflows").select("name").eq("id", wfId).single();
    expect(restored.name).toBe("Overwrite me");
  });

  it("defaults to new_draft (target untouched) when no mode is chosen for an existing target", async () => {
    const wfId = await insertWorkflow({ name: "Default-safe target", status: "inactive" });
    const sessionId = await insertSession({ linked_workflow_id: wfId });
    const versionId = await insertVersion(sessionId, baseConfig({ workflow: {
      name: "Default-mode variant", purpose: "", trigger_type: "manual", trigger_config: {},
      steps: [{ id: "s1", type: "trigger", next: "s2" }, { id: "s2", type: "create_task", title: "Task step" }],
    } as any }));

    // No mode passed — the server MUST fall back to the safe default.
    const res = await applyBuildVersionServer({ workspaceId: WS, userId: null, sessionId, versionId });
    expect(res.mode).toBe("new_draft");
    expect(res.requiresApproval).toBe(false);
    expect(res.workflowId).not.toBe(wfId);
    const { data: original } = await sb.from("workspace_workflows").select("name").eq("id", wfId).single();
    expect(original.name).toBe("Default-safe target"); // untouched
  });

  it("direct apply against a LIVE agent is forced into the approval workflow", async () => {
    await sb.from("agents").update({ settings: { isLive: true } }).eq("id", AGENT_ID);
    try {
      const sessionId = await insertSession({ target_agent_id: AGENT_ID });
      const versionId = await insertVersion(sessionId, baseConfig());
      const res = await applyBuildVersionServer({
        workspaceId: WS, userId: null, sessionId, versionId, mode: "direct",
      });
      expect(res.requiresApproval).toBe(true);
      expect(res.workflowId).toBeNull(); // nothing written until a human approves
      expect(res.hubActionId).toBeTruthy();
    } finally {
      await sb.from("agents").update({ settings: {} }).eq("id", AGENT_ID);
    }
  });

  it("throws with plain-English guidance on a block conflict", async () => {
    const wfId = await insertWorkflow();
    const { error: cfgErr } = await sb.from("custom_agent_configs").upsert({
      workspace_id: WS, agent_id: AGENT_ID, title: "e2e cfg 2",
      required_variables: [{ name: "deposit_amount" }],
      extraction_fields: [], deployment_config: {},
    });
    expect(cfgErr).toBeNull();
    const sessionId = await insertSession({ linked_workflow_id: wfId, target_agent_id: AGENT_ID });
    const versionId = await insertVersion(sessionId, baseConfig({
      agent_prompt: "Confirm the {{deposit_amount}} with the customer.",
      variables: [],
    }));
    await expect(
      applyBuildVersionServer({ workspaceId: WS, userId: null, sessionId, versionId, mode: "direct" }),
    ).rejects.toThrow(/can't be applied|cannot be applied|blocked/i);

    // Version must be untouched — still applyable after the config is fixed.
    const v = await getVersionRow(versionId);
    expect(v.status).toBe("draft");
  });

  it("blocks Apply & Go Live when a go-live gate is present", async () => {
    const sessionId = await insertSession();
    const cfg = baseConfig();
    (cfg.workflow.steps as any[]).push({ id: "s3", type: "send_whatsapp", title: "WA" });
    const versionId = await insertVersion(sessionId, cfg);
    await expect(
      applyBuildVersionServer({ workspaceId: WS, userId: null, sessionId, versionId, mode: "direct", goLiveIntent: true }),
    ).rejects.toThrow(/go live was blocked/i);
    // A plain apply of the same version is NOT blocked outright — WhatsApp
    // messaging is high-risk, so it routes into the approval workflow instead.
    const res = await applyBuildVersionServer({ workspaceId: WS, userId: null, sessionId, versionId });
    expect(res.requiresApproval).toBe(true);
    expect(res.workflowId).toBeNull(); // nothing written until a human approves
  });

  it("safety report runs read-only and matches the apply-time impact", async () => {
    const wfId = await insertWorkflow({ name: "Report target", status: "active" });
    const sessionId = await insertSession({ linked_workflow_id: wfId });
    const versionId = await insertVersion(sessionId, baseConfig());
    const before = await sb.from("workspace_workflows").select("updated_at").eq("id", wfId).single();

    const report = await getBuildApplySafetyReportServer({ workspaceId: WS, userId: null, sessionId, versionId });
    expect(report.impact.targetIsLive).toBe(true);
    expect(report.impact.conflicts.some((c) => c.code === "live_target")).toBe(true);
    expect(report.impact.requiresApproval).toBe(true);

    const after = await sb.from("workspace_workflows").select("updated_at").eq("id", wfId).single();
    expect(after.data.updated_at).toBe(before.data.updated_at); // no writes to the target
    await sb.from("workspace_workflows").update({ status: "inactive" }).eq("id", wfId);
  });
});
