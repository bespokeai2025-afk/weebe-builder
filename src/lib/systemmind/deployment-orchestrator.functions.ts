// ── SystemMind Deployment Orchestrator — client-callable server fns ────────────
// Thin wrappers over deployment-orchestrator.server.ts. All workspace/user
// scoping comes from server context (requireSupabaseAuth) — NEVER from client
// input. Dynamic imports use string literals (prod Rollup requirement).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAction } from "@/lib/permissions/permissions.server";

function requireWorkspaceId(workspaceId: string | undefined): string {
  if (!workspaceId) throw new Error("No workspace selected — join or create a workspace first.");
  return workspaceId;
}

function requireUserId(userId: string | undefined | null): string {
  if (!userId) throw new Error("Not signed in.");
  return userId;
}

const DEPLOYMENT_TYPES = [
  "receptionist",
  "lead_generation",
  "qualification",
  "whatsapp",
  "sms",
  "custom_workflow",
] as const;

const APPROVAL_ACTION_TYPES = [
  "purchase_number",
  "assign_number",
  "import_sip",
  "reassign_number",
  "go_live",
] as const;

// ── Lifecycle ──────────────────────────────────────────────────────────────────

export const startAgentDeployment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        agentId: z.string().uuid(),
        deploymentType: z.enum(DEPLOYMENT_TYPES).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { getOrCreateDeploymentServer } = await import(
      "@/lib/systemmind/deployment-orchestrator.server"
    );
    return getOrCreateDeploymentServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: context.userId ?? null,
      agentId: data.agentId,
      deploymentType: data.deploymentType,
    });
  });

export const getDeploymentChecklist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ deploymentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindView } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindView(context.workspaceId, context.userId);
    }
    const { computeDeploymentChecklistServer } = await import(
      "@/lib/systemmind/deployment-orchestrator.server"
    );
    return computeDeploymentChecklistServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      deploymentId: data.deploymentId,
    });
  });

export const getDeploymentForAgent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ agentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindView } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindView(context.workspaceId, context.userId);
    }
    const workspaceId = requireWorkspaceId(context.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await (supabaseAdmin as any)
      .from("systemmind_deployments")
      .select("id, status")
      .eq("workspace_id", workspaceId)
      .eq("agent_id", data.agentId)
      .neq("status", "abandoned")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { deploymentId: (row?.id as string | undefined) ?? null, status: row?.status ?? null };
  });

export const listAgentDeployments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    {
      const { requireSystemMindView } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindView(context.workspaceId, context.userId);
    }
    const { listDeploymentsServer } = await import(
      "@/lib/systemmind/deployment-orchestrator.server"
    );
    return listDeploymentsServer({ workspaceId: requireWorkspaceId(context.workspaceId) });
  });

export const setDeploymentChecklistOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        deploymentId: z.string().uuid(),
        overrides: z
          .object({
            telephony_path: z.enum(["purchase_retell", "existing_number", "sip", "skip"]).optional(),
            test_call: z.enum(["passed", "failed", "skipped"]).optional(),
            followup_configured: z.boolean().optional(),
            extraction_confirmed: z.boolean().optional(),
            crm_mapping_confirmed: z.boolean().optional(),
          })
          .strict(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindApproval } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindApproval(context.workspaceId, context.userId);
    }
    const { setChecklistOverrideServer } = await import(
      "@/lib/systemmind/deployment-orchestrator.server"
    );
    await setChecklistOverrideServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: context.userId ?? null,
      deploymentId: data.deploymentId,
      overrides: data.overrides,
    });
    return { ok: true };
  });

export const setDeploymentActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ deploymentId: z.string().uuid(), active: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindApproval } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindApproval(context.workspaceId, context.userId);
    }
    const { setDeploymentActiveServer } = await import(
      "@/lib/systemmind/deployment-orchestrator.server"
    );
    await setDeploymentActiveServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: context.userId ?? null,
      deploymentId: data.deploymentId,
      active: data.active,
    });
    return { ok: true };
  });

// ── Approvals ──────────────────────────────────────────────────────────────────

export const requestDeploymentApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        deploymentId: z.string().uuid(),
        actionType: z.enum(APPROVAL_ACTION_TYPES),
        payload: z.record(z.string(), z.unknown()).default({}),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { requestDeploymentApprovalServer } = await import(
      "@/lib/systemmind/deployment-orchestrator.server"
    );
    return requestDeploymentApprovalServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: context.userId ?? null,
      deploymentId: data.deploymentId,
      actionType: data.actionType,
      payload: data.payload as Record<string, unknown>,
    });
  });

export const decideDeploymentApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ approvalId: z.string().uuid(), approve: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAction(context.workspaceId, context.userId, "systemmind_approval");
    const { decideDeploymentApprovalServer } = await import(
      "@/lib/systemmind/deployment-orchestrator.server"
    );
    await decideDeploymentApprovalServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: requireUserId(context.userId),
      approvalId: data.approvalId,
      approve: data.approve,
    });
    return { ok: true };
  });

export const executeApprovedDeploymentAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ approvalId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAction(context.workspaceId, context.userId, "systemmind_approval");
    const { executeApprovedDeploymentActionServer } = await import(
      "@/lib/systemmind/deployment-orchestrator.server"
    );
    return executeApprovedDeploymentActionServer({
      supabase: context.supabase,
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: requireUserId(context.userId),
      approvalId: data.approvalId,
    });
  });

// ── Telephony helpers ──────────────────────────────────────────────────────────

export const listDeploymentWorkspaceNumbers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ agentRowId: z.string().uuid().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindView } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindView(context.workspaceId, context.userId);
    }
    const { listWorkspaceNumbersServer } = await import(
      "@/lib/systemmind/deployment-orchestrator.server"
    );
    return listWorkspaceNumbersServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: requireUserId(context.userId),
      agentRowId: data.agentRowId,
    });
  });
