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
    const { getSetupStateServer, computeRequiredInputs, computeContextCompleteness } = await import("@/lib/systemmind/setup-console.server");
    const state = await getSetupStateServer(requireWorkspaceId(context.workspaceId), data.sessionId);
    return { state, requiredInputs: computeRequiredInputs(state), contextCompleteness: computeContextCompleteness(state) };
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
    const { updateSetupStateServer, computeRequiredInputs, computeContextCompleteness } = await import("@/lib/systemmind/setup-console.server");
    const state = await updateSetupStateServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: context.userId!,
      sessionId: data.sessionId,
      mappingPatches: data.mappingPatches,
      crmPatch: data.crmPatch,
      triggers: data.triggers,
    });
    return { state, requiredInputs: computeRequiredInputs(state), contextCompleteness: computeContextCompleteness(state) };
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
    const { refreshSetupCrmStatusServer, computeRequiredInputs, computeContextCompleteness } = await import("@/lib/systemmind/setup-console.server");
    const state = await refreshSetupCrmStatusServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: context.userId!,
      sessionId: data.sessionId,
    });
    return { state, requiredInputs: computeRequiredInputs(state), contextCompleteness: computeContextCompleteness(state) };
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
    const { generateSetupTestPayloadServer, computeRequiredInputs, computeContextCompleteness } = await import("@/lib/systemmind/setup-console.server");
    const state = await generateSetupTestPayloadServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: context.userId!,
      sessionId: data.sessionId,
    });
    return { state, requiredInputs: computeRequiredInputs(state), contextCompleteness: computeContextCompleteness(state) };
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
    const { runSetupTestServer, computeRequiredInputs, computeContextCompleteness } = await import("@/lib/systemmind/setup-console.server");
    const state = await runSetupTestServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: context.userId!,
      sessionId: data.sessionId,
    });
    return { state, requiredInputs: computeRequiredInputs(state), contextCompleteness: computeContextCompleteness(state) };
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
    const { approveSetupServer, computeRequiredInputs, computeContextCompleteness } = await import("@/lib/systemmind/setup-console.server");
    const state = await approveSetupServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: context.userId!,
      sessionId: data.sessionId,
    });
    return { state, requiredInputs: computeRequiredInputs(state), contextCompleteness: computeContextCompleteness(state) };
  });

// ── Required Context fns ──────────────────────────────────────────────────────
// Schema duplicated inline (keep in sync with ContextPatchSchema in
// setup-console.server.ts) — importing the server module here would pull it
// into the client bundle.

const CTX_STR = z.string().max(2000);
const CTX_ARR = z.array(z.string().max(200)).max(60);
const ContextPatchInputSchema = z.object({
  business: z.object({
    businessName: CTX_STR, industry: CTX_STR, mainGoal: CTX_STR, problem: CTX_STR,
    audience: CTX_STR, desiredOutcome: CTX_STR, onSuccess: CTX_STR, onFailure: CTX_STR,
  }).partial().optional(),
  agent: z.object({
    channel: CTX_STR, direction: CTX_STR, lifecycle: CTX_STR, updateMode: CTX_STR, scanTarget: CTX_STR,
  }).partial().optional(),
  data: z.object({
    requiredFields: CTX_ARR, optionalFields: CTX_ARR, preProvidedFields: CTX_ARR, postCallFields: CTX_ARR,
    saveToWebee: z.boolean().nullable(), sendToCrm: z.boolean().nullable(), fieldsConfirmed: z.boolean(),
  }).partial().optional(),
  crm: z.object({
    syncRequired: z.boolean().nullable(), objectTable: CTX_STR, pipeline: CTX_STR, owner: CTX_STR,
    sourceCode: CTX_STR, duplicateRule: CTX_STR, updateFields: CTX_STR, triggerStatuses: CTX_STR,
  }).partial().optional(),
  trigger: z.object({
    source: CTX_STR, object: CTX_STR, field: CTX_STR, value: CTX_STR,
    frequency: CTX_STR, timing: CTX_STR, scopeFilter: CTX_STR,
  }).partial().optional(),
  outcome: z.object({ finalAction: CTX_STR, actions: CTX_ARR, notes: CTX_STR }).partial().optional(),
  booking: z.object({
    required: z.boolean().nullable(), calendarProvider: CTX_STR, eventType: CTX_STR, bookingVariable: CTX_STR,
    duration: CTX_STR, timezone: CTX_STR, availabilityRules: CTX_STR, confirmationMessage: CTX_STR,
    rebookingRules: CTX_STR, cancellationHandling: CTX_STR, crmAppointmentField: CTX_STR,
  }).partial().optional(),
  followup: z.object({
    enabled: z.boolean().nullable(), channel: CTX_STR, delay: CTX_STR, attempts: CTX_STR,
    stopConditions: CTX_STR, templates: CTX_STR, owner: CTX_STR, stopStatuses: CTX_STR,
  }).partial().optional(),
  compliance: z.object({
    canContact: z.boolean().nullable(), consentSource: CTX_STR, dncRules: CTX_STR, region: CTX_STR,
    callingHours: CTX_STR, disclaimers: CTX_STR, escalationRules: CTX_STR, handoverRules: CTX_STR,
  }).partial().optional(),
  success: z.object({
    definition: CTX_STR, testProves: CTX_STR, webeeExpectation: CTX_STR,
    crmExpectation: CTX_STR, mustNotHappen: CTX_STR, approver: CTX_STR,
  }).partial().optional(),
});

export const saveSetupContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid(), patch: ContextPatchInputSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import("@/lib/systemmind/systemmind-access.server");
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { saveSetupContextServer, computeRequiredInputs, computeContextCompleteness } =
      await import("@/lib/systemmind/setup-console.server");
    const state = await saveSetupContextServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: context.userId!,
      sessionId: data.sessionId,
      patch: data.patch,
    });
    return { state, requiredInputs: computeRequiredInputs(state), contextCompleteness: computeContextCompleteness(state) };
  });

export const autoSuggestSetupContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import("@/lib/systemmind/systemmind-access.server");
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { autoSuggestSetupContextServer, computeRequiredInputs, computeContextCompleteness } =
      await import("@/lib/systemmind/setup-console.server");
    const state = await autoSuggestSetupContextServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: context.userId!,
      sessionId: data.sessionId,
    });
    return { state, requiredInputs: computeRequiredInputs(state), contextCompleteness: computeContextCompleteness(state) };
  });

export const confirmSetupContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import("@/lib/systemmind/systemmind-access.server");
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { confirmSetupContextServer, computeRequiredInputs, computeContextCompleteness } =
      await import("@/lib/systemmind/setup-console.server");
    const state = await confirmSetupContextServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId: context.userId!,
      sessionId: data.sessionId,
    });
    return { state, requiredInputs: computeRequiredInputs(state), contextCompleteness: computeContextCompleteness(state) };
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
