// ── SystemMind Dynamic Variable Engine — server function entry points ─────────
// Thin createServerFn wrappers over variable-engine.server.ts. workspace_id and
// user_id come ONLY from the auth middleware context — never from client input.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function gate(context: any, mode: "view" | "edit") {
  const { requireSystemMindView, requireSystemMindEdit } = await import("@/lib/systemmind/systemmind-access.server");
  if (mode === "edit") await requireSystemMindEdit(context.workspaceId, context.userId);
  else await requireSystemMindView(context.workspaceId, context.userId);
}

export const listAgentsForVariableEngineFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    await gate(context, "view");
    const { assertNotWbahWorkspace } = await import("@/lib/wbah-exclusion.shared");
    assertNotWbahWorkspace(context.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any).from("agents")
      .select("id, name, agent_type, retell_agent_id")
      .eq("workspace_id", context.workspaceId)
      .order("name", { ascending: true }).limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []).map((a: any) => ({
      id: String(a.id),
      name: String(a.name ?? "Agent"),
      agentType: String(a.agent_type ?? "custom"),
      isDeployed: !!a.retell_agent_id,
    }));
  });

export const scanAgentVariablesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: { agentId: string; crmProvider?: string | null; useAi?: boolean }) =>
    z.object({
      agentId: z.string().uuid(),
      crmProvider: z.string().max(60).nullish(),
      useAi: z.boolean().optional(),
    }).parse(i),
  )
  .handler(async ({ context, data }: any) => {
    await gate(context, "edit");
    const { scanAgentVariablesServer } = await import("@/lib/systemmind/variable-engine.server");
    return scanAgentVariablesServer({
      workspaceId: context.workspaceId,
      userId: context.userId ?? null,
      agentId: data.agentId,
      crmProvider: data.crmProvider ?? null,
      useAi: data.useAi === true,
    });
  });

export const listDynamicVariablesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: { agentId: string }) => z.object({ agentId: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }: any) => {
    await gate(context, "view");
    const { listDynamicVariablesServer, getLatestScanServer } = await import("@/lib/systemmind/variable-engine.server");
    const [variables, latestScan] = await Promise.all([
      listDynamicVariablesServer({ workspaceId: context.workspaceId, agentId: data.agentId }),
      getLatestScanServer({ workspaceId: context.workspaceId, agentId: data.agentId }),
    ]);
    return { variables, latestScan };
  });

export const reviewDynamicVariableFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: { variableId: string; action: string; edits?: Record<string, unknown> }) =>
    z.object({
      variableId: z.string().uuid(),
      action: z.enum(["approve", "reject", "edit", "reopen"]),
      edits: z.record(z.unknown()).optional(),
    }).parse(i),
  )
  .handler(async ({ context, data }: any) => {
    await gate(context, "edit");
    const { reviewDynamicVariableServer } = await import("@/lib/systemmind/variable-engine.server");
    return reviewDynamicVariableServer({
      workspaceId: context.workspaceId,
      userId: context.userId ?? null,
      variableId: data.variableId,
      action: data.action,
      edits: data.edits,
    });
  });

export const listTransformationRulesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    await gate(context, "view");
    const { listTransformationRulesServer } = await import("@/lib/systemmind/variable-engine.server");
    return listTransformationRulesServer({ workspaceId: context.workspaceId });
  });

export const saveTransformationRuleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: {
    id?: string | null; name: string; description?: string;
    ruleType: string; config: Record<string, unknown>; isActive?: boolean;
  }) =>
    z.object({
      id: z.string().uuid().nullish(),
      name: z.string().min(1).max(160),
      description: z.string().max(1000).optional(),
      ruleType: z.string().max(40),
      config: z.record(z.unknown()),
      isActive: z.boolean().optional(),
    }).parse(i),
  )
  .handler(async ({ context, data }: any) => {
    await gate(context, "edit");
    const { saveTransformationRuleServer } = await import("@/lib/systemmind/variable-engine.server");
    return saveTransformationRuleServer({
      workspaceId: context.workspaceId,
      userId: context.userId ?? null,
      ...data,
    });
  });

export const deleteTransformationRuleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }: any) => {
    await gate(context, "edit");
    const { deleteTransformationRuleServer } = await import("@/lib/systemmind/variable-engine.server");
    await deleteTransformationRuleServer({ workspaceId: context.workspaceId, userId: context.userId ?? null, id: data.id });
    return { ok: true };
  });

export const listVariableMappingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: { agentId: string }) => z.object({ agentId: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }: any) => {
    await gate(context, "view");
    const { listVariableMappingsServer } = await import("@/lib/systemmind/variable-engine.server");
    return listVariableMappingsServer({ workspaceId: context.workspaceId, agentId: data.agentId });
  });

export const saveVariableMappingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: {
    id?: string | null; variableId: string; direction: string;
    sourceSystem?: string; sourceObject?: string; sourceField?: string;
    destinationSystem?: string; destinationObject?: string; destinationField?: string;
    transformationRuleId?: string | null; isRequired?: boolean; isIgnored?: boolean; notes?: string;
  }) =>
    z.object({
      id: z.string().uuid().nullish(),
      variableId: z.string().uuid(),
      direction: z.string().max(40),
      sourceSystem: z.string().max(120).optional(),
      sourceObject: z.string().max(120).optional(),
      sourceField: z.string().max(200).optional(),
      destinationSystem: z.string().max(120).optional(),
      destinationObject: z.string().max(120).optional(),
      destinationField: z.string().max(200).optional(),
      transformationRuleId: z.string().uuid().nullish(),
      isRequired: z.boolean().optional(),
      isIgnored: z.boolean().optional(),
      notes: z.string().max(1000).optional(),
    }).parse(i),
  )
  .handler(async ({ context, data }: any) => {
    await gate(context, "edit");
    const { saveVariableMappingServer } = await import("@/lib/systemmind/variable-engine.server");
    return saveVariableMappingServer({
      workspaceId: context.workspaceId,
      userId: context.userId ?? null,
      ...data,
    });
  });

export const deleteVariableMappingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }: any) => {
    await gate(context, "edit");
    const { deleteVariableMappingServer } = await import("@/lib/systemmind/variable-engine.server");
    await deleteVariableMappingServer({ workspaceId: context.workspaceId, id: data.id });
    return { ok: true };
  });

export const testTransformationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: {
    ruleId?: string | null; ruleType?: string; config?: Record<string, unknown>;
    sampleValue: unknown; dataType?: string; fallbackValue?: unknown;
  }) =>
    z.object({
      ruleId: z.string().uuid().nullish(),
      ruleType: z.string().max(40).optional(),
      config: z.record(z.unknown()).optional(),
      sampleValue: z.unknown(),
      dataType: z.string().max(40).optional(),
      fallbackValue: z.unknown().optional(),
    }).parse(i),
  )
  .handler(async ({ context, data }: any) => {
    await gate(context, "view");
    const { testTransformationRuleServer } = await import("@/lib/systemmind/variable-engine.server");
    return testTransformationRuleServer({ workspaceId: context.workspaceId, ...data });
  });
