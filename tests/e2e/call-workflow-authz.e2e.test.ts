/**
 * E2E authorization matrix for Task #477: the 5 chat-run SystemMind
 * call-workflow mind tools (registry surface, gateCallWorkflowTool) and the
 * setup-wizard server-fn surface must enforce IDENTICAL access:
 *
 *   • owner/admin in an entitled workspace  → allowed
 *   • plain member (legacy "member" → manager role) → edit allowed, but
 *     sensitive tools (systemmind_approval) denied even with explicit approval
 *   • viewer-role member → edit denied on both surfaces
 *   • non-member → denied (fail closed)
 *   • non-entitled workspace (package without systemmind) → denied even for owner
 *   • WBAH workspace → hard-blocked
 *
 * Runs against the REAL shared Supabase database (service role) using
 * throw-away workspaces and cleans everything up.
 *
 * Run: npx vitest run --config vitest.e2e.config.ts tests/e2e/call-workflow-authz.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { executeMindTool, mindToolsReady, listMindTools } from "@/lib/minds/tool-registry.server";
import {
  requireSystemMindView,
  requireSystemMindEdit,
  requireSystemMindApproval,
} from "@/lib/systemmind/systemmind-access.server";
import { assertNotWbahWorkspace } from "@/lib/wbah-exclusion.shared";
import { invalidateEntitlementsCache } from "@/lib/packages/entitlements.server";
import { invalidatePermissionsCache } from "@/lib/permissions/permissions.server";

const sb = supabaseAdmin as any;

const WS_ENT = randomUUID();     // entitled workspace (package with systemmind)
const WS_UNENT = randomUUID();   // non-entitled workspace (no systemmind department)
const WBAH_WORKSPACE_ID = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";
const OUTSIDER = randomUUID();   // never a member anywhere

const CALL_WORKFLOW_TOOLS = [
  "systemmind.run_call_workflow_test",
  "systemmind.activate_call_workflow",
  "systemmind.set_call_workflow_state",
  "systemmind.save_call_trigger",
  "systemmind.retry_crm_writeback",
] as const;

let OWNER_ID = "";
let MEMBER_ID = "";
let AGENT_ID = "";
let ACTIVATION_ID = "";

function invalidateAll() {
  invalidateEntitlementsCache(WS_ENT, { broadcast: false });
  invalidateEntitlementsCache(WS_UNENT, { broadcast: false });
  invalidatePermissionsCache();
}

beforeAll(async () => {
  const { data: profiles, error: pErr } = await sb
    .from("profiles").select("user_id").limit(5);
  if (pErr || !profiles?.length) throw new Error("Need existing users for fixtures");
  OWNER_ID = profiles[0].user_id as string;
  MEMBER_ID = (profiles.find((p: any) => p.user_id !== OWNER_ID)?.user_id ?? "") as string;
  if (!MEMBER_ID) throw new Error("Need a second distinct user for the plain-member fixture");

  for (const [id, name] of [[WS_ENT, "e2e authz entitled"], [WS_UNENT, "e2e authz unentitled"]]) {
    const { error } = await sb.from("workspaces").insert({
      id, name, owner_id: OWNER_ID, slug: `e2e-authz-${String(id).slice(0, 8)}`,
    });
    if (error) throw new Error(`workspace fixture: ${error.message}`);
  }
  // Owner in both workspaces; plain member only in the entitled one.
  for (const row of [
    { workspace_id: WS_ENT, user_id: OWNER_ID, role: "owner" },
    { workspace_id: WS_ENT, user_id: MEMBER_ID, role: "member" },
    { workspace_id: WS_UNENT, user_id: OWNER_ID, role: "owner" },
  ]) {
    const { error } = await sb.from("workspace_members").insert(row);
    if (error) throw new Error(`member fixture: ${error.message}`);
  }

  // Entitlements: WS_ENT gets a package WITH the systemmind department,
  // WS_UNENT gets one WITHOUT it.
  const { PACKAGE_CATALOG } = await import("@/lib/packages/packages.shared");
  const withSm = PACKAGE_CATALOG.find((p: any) => p.aiDepartments?.includes("systemmind"));
  const withoutSm = PACKAGE_CATALOG.find((p: any) => !p.aiDepartments?.includes("systemmind"));
  if (!withSm || !withoutSm) throw new Error("Package catalog missing expected packages");
  for (const [ws, pkg] of [[WS_ENT, withSm], [WS_UNENT, withoutSm]] as const) {
    const { error } = await sb.from("workspace_subscriptions").insert({
      workspace_id: ws, package_key: (pkg as any).packageKey, subscription_status: "active",
    });
    if (error) throw new Error(`subscription fixture: ${error.message}`);
  }
  invalidateAll();

  // Agent + draft activation so registry tools have something real to act on.
  const { data: agent, error: aErr } = await sb.from("agents").insert({
    workspace_id: WS_ENT, user_id: OWNER_ID, name: "e2e authz agent",
    settings: {
      agentType: "client_qualification", channelType: "voice",
      globalPrompt: "Greet {{first_name}} and confirm {{phone_number}}.",
    },
    flow_data: { nodes: [], edges: [] },
  }).select("id").single();
  if (aErr) throw new Error(`agent fixture: ${aErr.message}`);
  AGENT_ID = agent.id as string;

  const { getOrCreateDraftActivationServer } = await import(
    "@/lib/systemmind/call-runtime/setup-wizard.server"
  );
  const draft = await getOrCreateDraftActivationServer({
    workspaceId: WS_ENT, userId: OWNER_ID, agentId: AGENT_ID,
  });
  ACTIVATION_ID = draft.id as string;
}, 60000);

afterAll(async () => {
  for (const ws of [WS_ENT, WS_UNENT]) {
    for (const table of [
      "mind_tool_executions", "workspace_access_audit_logs",
      "systemmind_call_triggers", "systemmind_integration_errors",
      "systemmind_workflow_activations", "systemmind_audit_logs",
      "workspace_subscriptions", "workspace_member_roles",
      "agents",
    ]) {
      await sb.from(table).delete().eq("workspace_id", ws);
    }
    await sb.from("workspace_members").delete().eq("workspace_id", ws);
    await sb.from("workspaces").delete().eq("id", ws);
  }
  invalidateAll();
}, 60000);

// ── Server-fn surface: the exact guards setup-wizard.functions.ts calls ──────

describe("server-fn surface guards (requireSystemMindView/Edit + WBAH)", () => {
  it("owner in entitled workspace: view, edit and approval all pass", async () => {
    await expect(requireSystemMindView(WS_ENT, OWNER_ID)).resolves.toBeTruthy();
    await expect(requireSystemMindEdit(WS_ENT, OWNER_ID)).resolves.toBeTruthy();
    await expect(requireSystemMindApproval(WS_ENT, OWNER_ID)).resolves.toBeTruthy();
  });

  it("plain member (manager): edit passes, approval is DENIED", async () => {
    await expect(requireSystemMindEdit(WS_ENT, MEMBER_ID)).resolves.toBeTruthy();
    await expect(requireSystemMindApproval(WS_ENT, MEMBER_ID)).rejects.toThrow();
  });

  it("viewer-role member: view passes, edit is DENIED", async () => {
    const { error } = await sb.from("workspace_member_roles").insert({
      workspace_id: WS_ENT, user_id: MEMBER_ID, role_key: "viewer",
    });
    expect(error).toBeNull();
    invalidatePermissionsCache();
    try {
      await expect(requireSystemMindView(WS_ENT, MEMBER_ID)).resolves.toBeTruthy();
      await expect(requireSystemMindEdit(WS_ENT, MEMBER_ID)).rejects.toThrow();
    } finally {
      await sb.from("workspace_member_roles")
        .delete().eq("workspace_id", WS_ENT).eq("user_id", MEMBER_ID);
      invalidatePermissionsCache();
    }
  });

  it("non-member: everything DENIED (fail closed)", async () => {
    await expect(requireSystemMindView(WS_ENT, OUTSIDER)).rejects.toThrow();
    await expect(requireSystemMindEdit(WS_ENT, OUTSIDER)).rejects.toThrow();
  });

  it("non-entitled workspace: even the OWNER is denied (package cap)", async () => {
    await expect(requireSystemMindView(WS_UNENT, OWNER_ID)).rejects.toThrow();
    await expect(requireSystemMindEdit(WS_UNENT, OWNER_ID)).rejects.toThrow();
  });

  it("WBAH workspace is hard-blocked before any work", async () => {
    expect(() => assertNotWbahWorkspace(WBAH_WORKSPACE_ID)).toThrow();
    const { runWorkflowTestsServer } = await import(
      "@/lib/systemmind/call-runtime/setup-wizard.server"
    );
    await expect(runWorkflowTestsServer({
      workspaceId: WBAH_WORKSPACE_ID, userId: OWNER_ID, activationId: ACTIVATION_ID,
    })).rejects.toThrow();
  });
});

// ── Registry surface: executeMindTool end-to-end ─────────────────────────────

describe("registry surface (chat-run tools via executeMindTool)", () => {
  it("all 5 call-workflow tools are registered on the registry surface", async () => {
    await mindToolsReady();
    const byName = new Map(listMindTools().map((t) => [t.name, t]));
    for (const name of CALL_WORKFLOW_TOOLS) {
      const tool = byName.get(name);
      expect(tool, name).toBeTruthy();
      expect(tool!.surface).toBe("registry");
    }
    // Sensitive tools declare the approval entitlement.
    for (const name of [
      "systemmind.activate_call_workflow",
      "systemmind.set_call_workflow_state",
      "systemmind.save_call_trigger",
    ]) {
      expect(byName.get(name)!.sensitive).toBe(true);
      expect(byName.get(name)!.requiredActionKey).toBe("systemmind_approval");
    }
  });

  it("owner: non-sensitive run_call_workflow_test COMPLETES", async () => {
    const res = await executeMindTool({
      sb, workspaceId: WS_ENT, userId: OWNER_ID, platform: "web",
      toolName: "systemmind.run_call_workflow_test",
      input: { activationId: ACTIVATION_ID }, initiatedBy: "user",
    });
    expect(res.status).toBe("completed");
    expect(res.affectedRecordId).toBe(ACTIVATION_ID);
  });

  it("plain member: non-sensitive tool completes (edit-level access is enough)", async () => {
    const res = await executeMindTool({
      sb, workspaceId: WS_ENT, userId: MEMBER_ID, platform: "web",
      toolName: "systemmind.run_call_workflow_test",
      input: { activationId: ACTIVATION_ID }, initiatedBy: "user",
    });
    expect(res.status).toBe("completed");
  });

  it("sensitive activate tool WITHOUT explicit approval → approval_required (never runs)", async () => {
    const res = await executeMindTool({
      sb, workspaceId: WS_ENT, userId: OWNER_ID, platform: "web",
      toolName: "systemmind.activate_call_workflow",
      input: { activationId: ACTIVATION_ID }, initiatedBy: "user",
    });
    expect(res.status).toBe("approval_required");
  });

  it("plain member + sensitive tool is BLOCKED even WITH explicit approval", async () => {
    const res = await executeMindTool({
      sb, workspaceId: WS_ENT, userId: MEMBER_ID, platform: "web",
      toolName: "systemmind.activate_call_workflow",
      input: { activationId: ACTIVATION_ID }, initiatedBy: "user",
      explicitApproval: true,
    });
    expect(["blocked", "failed"]).toContain(res.status);
    expect(res.status).not.toBe("completed");
    // No activation happened.
    const { data: act } = await sb.from("systemmind_workflow_activations")
      .select("status").eq("id", ACTIVATION_ID).single();
    expect(act.status).not.toBe("active");
  });

  it("owner + sensitive activate WITH explicit approval → completes (tests passed)", async () => {
    await sb.from("systemmind_workflow_activations")
      .update({ test_passed: true }).eq("id", ACTIVATION_ID);
    const res = await executeMindTool({
      sb, workspaceId: WS_ENT, userId: OWNER_ID, platform: "web",
      toolName: "systemmind.activate_call_workflow",
      input: { activationId: ACTIVATION_ID }, initiatedBy: "user",
      explicitApproval: true,
    });
    expect(res.status).toBe("completed");
    const { data: act } = await sb.from("systemmind_workflow_activations")
      .select("status").eq("id", ACTIVATION_ID).single();
    expect(act.status).toBe("active");
  });

  it("viewer-role member is denied on the registry surface too", async () => {
    const { error } = await sb.from("workspace_member_roles").insert({
      workspace_id: WS_ENT, user_id: MEMBER_ID, role_key: "viewer",
    });
    expect(error).toBeNull();
    invalidatePermissionsCache();
    try {
      const res = await executeMindTool({
        sb, workspaceId: WS_ENT, userId: MEMBER_ID, platform: "web",
        toolName: "systemmind.run_call_workflow_test",
        input: { activationId: ACTIVATION_ID }, initiatedBy: "user",
      });
      expect(res.status).not.toBe("completed");
    } finally {
      await sb.from("workspace_member_roles")
        .delete().eq("workspace_id", WS_ENT).eq("user_id", MEMBER_ID);
      invalidatePermissionsCache();
    }
  });

  it("non-member is blocked with an audit row", async () => {
    const res = await executeMindTool({
      sb, workspaceId: WS_ENT, userId: OUTSIDER, platform: "web",
      toolName: "systemmind.run_call_workflow_test",
      input: { activationId: ACTIVATION_ID }, initiatedBy: "user",
    });
    expect(res.status).toBe("blocked");
    expect(res.executionId).toBeTruthy();
    const { data: row } = await sb.from("mind_tool_executions")
      .select("status, user_id").eq("id", res.executionId).single();
    expect(row.status).toBe("blocked");
    expect(row.user_id).toBe(OUTSIDER);
  });

  it("non-entitled workspace: owner is denied on the registry surface too", async () => {
    const res = await executeMindTool({
      sb, workspaceId: WS_UNENT, userId: OWNER_ID, platform: "web",
      toolName: "systemmind.run_call_workflow_test",
      input: { activationId: ACTIVATION_ID }, initiatedBy: "user",
    });
    expect(res.status).not.toBe("completed");
  });

  it("WBAH workspace never completes a call-workflow tool", async () => {
    const res = await executeMindTool({
      sb, workspaceId: WBAH_WORKSPACE_ID, userId: OWNER_ID, platform: "web",
      toolName: "systemmind.run_call_workflow_test",
      input: { activationId: ACTIVATION_ID }, initiatedBy: "user",
    });
    expect(res.status).not.toBe("completed");
  });
});

// ── Surface-parity guardrails (source-level, prevents drift) ─────────────────

describe("surface parity guardrails", () => {
  it("every call-workflow registry tool run-path calls gateCallWorkflowTool", () => {
    const src = readFileSync("src/lib/minds/register-tools.server.ts", "utf8");
    for (const name of CALL_WORKFLOW_TOOLS) {
      const idx = src.indexOf(`name: "${name}"`);
      expect(idx, name).toBeGreaterThan(-1);
      // The gate call must appear inside this tool's registration block
      // (before the next registerMindTool or EOF).
      const next = src.indexOf("registerMindTool(", idx);
      const block = src.slice(idx, next === -1 ? undefined : next + 2000);
      expect(block.includes("await gateCallWorkflowTool(ctx)"), name).toBe(true);
    }
    // The gate itself enforces the SAME primitives as the server-fn surface.
    expect(src).toContain("assertNotWbahWorkspace(ctx.workspaceId)");
    expect(src).toContain("requireSystemMindEdit(ctx.workspaceId, ctx.userId)");
  });

  it("every exported server fn in setup-wizard.functions.ts gates access", () => {
    const src = readFileSync("src/lib/systemmind/call-runtime/setup-wizard.functions.ts", "utf8");
    const fnBlocks = src.split(/export const /).slice(1);
    const gated = fnBlocks.filter((b) => b.includes("createServerFn"));
    expect(gated.length).toBeGreaterThanOrEqual(15);
    for (const block of gated) {
      const name = block.slice(0, block.indexOf(" "));
      expect(block.includes("requireSupabaseAuth"), `${name} missing auth middleware`).toBe(true);
      expect(/await gate\(context, "(view|edit)"\)/.test(block), `${name} missing gate()`).toBe(true);
    }
    // Mutating endpoints must gate at edit level.
    for (const name of [
      "getOrCreateDraftActivationFn", "runWorkflowTestsFn", "activateWorkflowFn",
      "setWorkflowStateFn", "saveCallTriggerFn", "setTriggerEnabledFn",
      "controlQueueEntryFn", "retryIntegrationErrorFn",
    ]) {
      const block = gated.find((b) => b.startsWith(name));
      expect(block, name).toBeTruthy();
      expect(block!.includes('gate(context, "edit")'), `${name} must gate at edit`).toBe(true);
    }
  });
});
