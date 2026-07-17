// ── SystemMind Setup Console — server fns ─────────────────────────────────────
// Thin auth wrappers over setup-console.server.ts. All fns are workspace-scoped
// via requireSupabaseAuth + SystemMind access checks (mirrors the Build
// Workspace fns). Credential values never travel through these fns.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function requireWorkspaceId(workspaceId: string | undefined): string {
  if (!workspaceId) throw new Error("No workspace selected — join or create a workspace first.");
  return workspaceId;
}

export const scanAgentForSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      sessionId: z.string().uuid(),
      agentId:   z.string().uuid().nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import("@/lib/systemmind/systemmind-access.server");
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { scanAgentForSetupServer } = await import("@/lib/systemmind/setup-console.server");
    return scanAgentForSetupServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: context.userId!,
      sessionId: data.sessionId,
      agentId: data.agentId ?? null,
    });
  });

export const getSetupState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindView } = await import("@/lib/systemmind/systemmind-access.server");
      await requireSystemMindView(context.workspaceId, context.userId);
    }
    const { getSetupStateServer, computeRequiredInputs } = await import("@/lib/systemmind/setup-console.server");
    const state = await getSetupStateServer(requireWorkspaceId(context.workspaceId), data.sessionId);
    return { state, requiredInputs: computeRequiredInputs(state) };
  });

const NO_SECRET_STRING = z.string().max(400);
const MappingPatchSchema = z.object({
  variable:       z.string().min(1).max(120),
  webeeField:     NO_SECRET_STRING.optional(),
  crmField:       NO_SECRET_STRING.optional(),
  fieldType:      NO_SECRET_STRING.optional(),
  required:       z.boolean().optional(),
  ignored:        z.boolean().optional(),
  defaultValue:   NO_SECRET_STRING.optional(),
  transformation: NO_SECRET_STRING.optional(),
  approved:       z.boolean().optional(),
});
const CrmPatchSchema = z.object({
  provider:        z.enum(["none", "webee", "hubspot", "gohighlevel", "salesforce", "pipedrive", "zoho", "dynamics", "custom"]).optional(),
  orgUrl:          NO_SECRET_STRING.optional(),
  defaultOwner:    NO_SECRET_STRING.optional(),
  defaultPipeline: NO_SECRET_STRING.optional(),
  defaultSource:   NO_SECRET_STRING.optional(),
  customEndpoints: z.object({
    baseUrl: NO_SECRET_STRING.optional(), authType: NO_SECRET_STRING.optional(),
    testPath: NO_SECRET_STRING.optional(), createLeadPath: NO_SECRET_STRING.optional(),
    updateLeadPath: NO_SECRET_STRING.optional(), statusUpdatePath: NO_SECRET_STRING.optional(),
  }).optional(),
});
const TriggerRuleInputSchema = z.object({
  id:           z.string().min(1).max(60),
  source:       NO_SECRET_STRING,
  object:       NO_SECRET_STRING,
  fieldLabel:   NO_SECRET_STRING,
  fieldApiCode: NO_SECRET_STRING,
  statusName:   NO_SECRET_STRING,
  statusCode:   NO_SECRET_STRING,
  condition:    NO_SECRET_STRING,
  action:       NO_SECRET_STRING,
});

export const updateSetupState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      sessionId:      z.string().uuid(),
      mappingPatches: z.array(MappingPatchSchema).max(150).optional(),
      crmPatch:       CrmPatchSchema.optional(),
      triggers:       z.array(TriggerRuleInputSchema).max(40).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import("@/lib/systemmind/systemmind-access.server");
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { updateSetupStateServer, computeRequiredInputs } = await import("@/lib/systemmind/setup-console.server");
    const state = await updateSetupStateServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: context.userId!,
      sessionId: data.sessionId,
      mappingPatches: data.mappingPatches,
      crmPatch: data.crmPatch,
      triggers: data.triggers,
    });
    return { state, requiredInputs: computeRequiredInputs(state) };
  });

export const refreshSetupCrmStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import("@/lib/systemmind/systemmind-access.server");
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { refreshSetupCrmStatusServer, computeRequiredInputs } = await import("@/lib/systemmind/setup-console.server");
    const state = await refreshSetupCrmStatusServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: context.userId!,
      sessionId: data.sessionId,
    });
    return { state, requiredInputs: computeRequiredInputs(state) };
  });

export const generateSetupTestPayload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import("@/lib/systemmind/systemmind-access.server");
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { generateSetupTestPayloadServer, computeRequiredInputs } = await import("@/lib/systemmind/setup-console.server");
    const state = await generateSetupTestPayloadServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: context.userId!,
      sessionId: data.sessionId,
    });
    return { state, requiredInputs: computeRequiredInputs(state) };
  });

export const runSetupTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import("@/lib/systemmind/systemmind-access.server");
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { runSetupTestServer, computeRequiredInputs } = await import("@/lib/systemmind/setup-console.server");
    const state = await runSetupTestServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: context.userId!,
      sessionId: data.sessionId,
    });
    return { state, requiredInputs: computeRequiredInputs(state) };
  });

export const approveSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import("@/lib/systemmind/systemmind-access.server");
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { approveSetupServer, computeRequiredInputs } = await import("@/lib/systemmind/setup-console.server");
    const state = await approveSetupServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: context.userId!,
      sessionId: data.sessionId,
    });
    return { state, requiredInputs: computeRequiredInputs(state) };
  });

// Lightweight agent list for the "Change Agent" picker (workspace-scoped).
export const listAgentsForSetup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    {
      const { requireSystemMindView } = await import("@/lib/systemmind/systemmind-access.server");
      await requireSystemMindView(context.workspaceId, context.userId);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const workspaceId = requireWorkspaceId(context.workspaceId);
    const { data, error } = await (supabaseAdmin as any).from("agents")
      .select("id, name, agent_type, retell_agent_id, settings")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(`Failed to list agents: ${error.message}`);
    return (data ?? []).map((a: any) => ({
      id: String(a.id),
      name: String(a.name ?? "Agent"),
      agentType: String(a.settings?.agentType ?? a.agent_type ?? "custom"),
      channel: a.settings?.channelType === "whatsapp" ? "whatsapp" : "voice",
      isLive: !!(a.retell_agent_id || a.settings?.deployedElevenLabsAgentId),
    }));
  });
