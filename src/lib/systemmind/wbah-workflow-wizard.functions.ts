import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireActiveWbahWorkspace } from "@/lib/wbah-exclusion.shared";

async function assertWbah(ctx: { workspaceId?: string | null; userId?: string }) {
  if (!ctx.workspaceId) throw new Error("No workspace");
  requireActiveWbahWorkspace(ctx.workspaceId);
}

export const startWbahWorkflowWizardFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z
      .object({
        mode: z.enum(["blank", "template"]).optional(),
      })
      .optional(),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await assertWbah(ctx);
    const { startWbahWorkflowWizardServer } = await import(
      "@/lib/systemmind/wbah-workflow-wizard.server"
    );
    return startWbahWorkflowWizardServer({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId ?? null,
      mode: data?.mode ?? "blank",
    });
  });

export const saveWbahWorkflowConfigFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      sessionId: z.string().uuid(),
      answers: z.record(z.union([z.string(), z.boolean(), z.array(z.string())])),
      stepOverrides: z
        .array(
          z.object({
            id: z.string(),
            enabled: z.boolean(),
          }),
        )
        .optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await assertWbah(ctx);
    const answers = { ...data.answers };
    if (data.stepOverrides?.length) {
      for (const o of data.stepOverrides) {
        if (o.id === "live_transcript") answers.enable_live_transcript = o.enabled;
        if (o.id === "dashboard_raw" || o.id === "dashboard_analyzed") {
          answers.enable_dashboard = o.enabled;
        }
        if (o.id === "calendly_link") answers.enable_calendly = o.enabled;
        if (o.id === "dynamics_allens") answers.enable_dynamics_status = o.enabled;
        if (o.id === "dynamics_agentic") answers.enable_dynamics_property = o.enabled;
        if (o.id === "wbah_calls_upsert") answers.enable_calls_tab = o.enabled;
      }
    }
    const { saveWbahWorkflowFromAnswersServer } = await import(
      "@/lib/systemmind/wbah-workflow-wizard.server"
    );
    return saveWbahWorkflowFromAnswersServer({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId ?? null,
      sessionId: data.sessionId,
      answers,
    });
  });

export const listWbahWorkflowsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as any;
    await assertWbah(ctx);
    const { listWbahPostCallWorkflows } = await import(
      "@/lib/wbah/workflow/wbah-workflow-resolver.server"
    );
    return listWbahPostCallWorkflows(ctx.workspaceId);
  });

export const activateWbahWorkflowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ workflowId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await assertWbah(ctx);
    const { activateWbahWorkflowServer } = await import(
      "@/lib/systemmind/wbah-workflow-wizard.server"
    );
    return activateWbahWorkflowServer({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId ?? null,
      workflowId: data.workflowId,
    });
  });

export const getWbahWorkflowCatalogFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as any;
    await assertWbah(ctx);
    const { catalogForUi, buildWbahWorkflowWizardQuestions } = await import(
      "@/lib/systemmind/wbah-workflow-wizard.server"
    );
    return {
      catalog: catalogForUi(),
      questions: buildWbahWorkflowWizardQuestions(),
    };
  });

const n8nGraphNodeSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
  position: z.object({ x: z.number(), y: z.number() }),
});

const n8nGraphSchema = z.object({
  nodes: z.array(n8nGraphNodeSchema),
  edges: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      sourceHandle: z.string().optional(),
    }),
  ),
});

const pipelineSchema = z.object({
  name: z.string(),
  purpose: z.string().optional(),
  executor: z.literal("webee_native").optional(),
  retell_agents: z.array(z.string()),
  steps: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      title: z.string().optional(),
      enabled: z.boolean(),
      next: z.string().optional(),
    }),
  ),
  n8n_graph: n8nGraphSchema.optional(),
});

export const promptWbahWorkflowCopilotFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      sessionId: z.string().uuid(),
      prompt: z.string().min(3).max(8000),
    }),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await assertWbah(ctx);
    const { promptWbahWorkflowCopilotServer } = await import(
      "@/lib/systemmind/wbah-workflow-copilot.server"
    );
    return promptWbahWorkflowCopilotServer({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId ?? null,
      sessionId: data.sessionId,
      prompt: data.prompt,
    });
  });

export const saveWbahPipelineFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      sessionId: z.string().uuid(),
      pipeline: pipelineSchema,
      graphMeta: z
        .object({
          nodes: z.array(z.object({ id: z.string(), position: z.object({ x: z.number(), y: z.number() }) })),
          edges: z.array(
            z.object({
              id: z.string(),
              source: z.string(),
              target: z.string(),
              sourceHandle: z.string().optional(),
            }),
          ),
        })
        .nullable()
        .optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await assertWbah(ctx);
    const { saveWbahPipelineConfigServer } = await import(
      "@/lib/systemmind/wbah-workflow-copilot.server"
    );
    return saveWbahPipelineConfigServer({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId ?? null,
      sessionId: data.sessionId,
      pipeline: data.pipeline as any,
      graphMeta: data.graphMeta ?? null,
    });
  });

export const getWbahWorkflowSessionFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ sessionId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await assertWbah(ctx);
    const { getBuildSessionServer } = await import("@/lib/systemmind/build-workspace.server");
    const { pipelineFromBuildConfig } = await import(
      "@/lib/systemmind/wbah-workflow-copilot.server"
    );
    const detail = await getBuildSessionServer(ctx.workspaceId, data.sessionId);
    const session = detail.session as Record<string, unknown>;
    const versions = (detail.versions ?? []) as Array<Record<string, unknown>>;
    const current = versions.find((v) => v.id === session?.current_version_id) ?? versions[0];
    const config = (current?.generated_config ?? null) as Record<string, unknown> | null;
    let { pipeline, graphMeta } = pipelineFromBuildConfig(config);
    const { hydratePipelineFromLatestExecution } = await import(
      "@/lib/wbah/workflow/wbah-workflow-node-execute.server"
    );
    pipeline = await hydratePipelineFromLatestExecution(ctx.workspaceId, pipeline);
    const messages = (detail.messages ?? []) as Array<Record<string, unknown>>;
    return {
      sessionId: data.sessionId,
      title: String(session?.title ?? "Workflow"),
      pipeline,
      graphMeta,
      messages: messages.map((m) => ({
        id: String(m.id ?? ""),
        role: String(m.role ?? "system"),
        content: String(m.content ?? ""),
        createdAt: m.created_at ? String(m.created_at) : undefined,
      })),
      versionNumber: typeof current?.version_number === "number" ? current.version_number : null,
    };
  });

export const getWbahPostCallQueueStatsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as any;
    await assertWbah(ctx);
    const { getWbahPostCallQueueStats } = await import(
      "@/lib/wbah/post-call/wbah-post-call-queue.server"
    );
    return getWbahPostCallQueueStats(ctx.workspaceId);
  });

export const getWbahPostCallEngineStatusFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as any;
    await assertWbah(ctx);
    const { getWbahPostCallEngineReadiness } = await import(
      "@/lib/wbah/post-call/wbah-post-call-engine-readiness.server"
    );
    return getWbahPostCallEngineReadiness();
  });

export const listWbahPostCallExecutionsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(
    z
      .object({
        status: z
          .enum([
            "all",
            "success",
            "warning",
            "failed",
            "queued",
            // legacy filter values
            "pending",
            "processing",
            "completed",
            "with_errors",
          ])
          .optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .optional(),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await assertWbah(ctx);
    const { listWbahPostCallExecutions } = await import(
      "@/lib/wbah/post-call/wbah-post-call-queue.server"
    );
    return listWbahPostCallExecutions(ctx.workspaceId, {
      status: data?.status ?? "all",
      limit: data?.limit ?? 50,
    });
  });

export const getWbahPostCallExecutionFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ jobId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await assertWbah(ctx);
    const { getWbahPostCallExecution } = await import(
      "@/lib/wbah/post-call/wbah-post-call-queue.server"
    );
    const row = await getWbahPostCallExecution(ctx.workspaceId, data.jobId);
    if (!row) throw new Error("Execution not found");
    return row;
  });

export const listWbahPostCallDraftsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as any;
    await assertWbah(ctx);
    const { listWbahPostCallDraftSessions } = await import(
      "@/lib/systemmind/wbah-workflow-wizard.server"
    );
    return listWbahPostCallDraftSessions(ctx.workspaceId);
  });

export const executeWbahNodeStepFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      pipeline: pipelineSchema,
      nodeId: z.string().min(1),
      pinData: z.unknown().optional(),
      dryRun: z.boolean().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await assertWbah(ctx);
    const { executeWbahWorkflowNodeStep } = await import(
      "@/lib/wbah/workflow/wbah-workflow-node-execute.server"
    );
    return executeWbahWorkflowNodeStep({
      pipeline: data.pipeline as any,
      nodeId: data.nodeId,
      pinData: data.pinData,
      dryRun: data.dryRun ?? true,
    });
  });
