/**
 * SystemMind server functions — automation engine (Phase 1: parse + validate).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertSystemMindView(ctx: { workspaceId?: string | null; userId?: string }) {
  if (!ctx.workspaceId) throw new Error("No workspace");
  const { requireSystemMindView } = await import("@/lib/systemmind/systemmind-access.server");
  await requireSystemMindView(ctx.workspaceId, ctx.userId);
}

export const validateAutomationWorkflowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ workflow: z.unknown() }))
  .handler(async ({ data, context }) => {
    await assertSystemMindView(context as any);
    const { validateWorkflowDocument, ensureAutomationEngineBootstrapped, listRegisteredNodeTypes } =
      await import("@/lib/automation-engine");
    ensureAutomationEngineBootstrapped();
    const result = validateWorkflowDocument(data.workflow);
    return {
      ...result,
      registeredNodeTypes: listRegisteredNodeTypes(),
    };
  });

export const parseAutomationWorkflowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ workflow: z.unknown() }))
  .handler(async ({ data, context }) => {
    await assertSystemMindView(context as any);
    const { parseWorkflowDocument, ensureAutomationEngineBootstrapped } = await import(
      "@/lib/automation-engine"
    );
    ensureAutomationEngineBootstrapped();
    const result = parseWorkflowDocument(data.workflow);
    if (!result.ok) {
      return { ok: false as const, errors: result.errors, summary: null, documentJson: null };
    }
    const w = result.workflow;
    let connectionCount = 0;
    for (const arr of w.connections.outgoing.values()) connectionCount += arr.length;
    return {
      ok: true as const,
      errors: [] as string[],
      summary: {
        id: w.id,
        name: w.name,
        version: w.version,
        nodeCount: w.nodes.size,
        entryNodes: w.entryNodeIds,
        connectionCount,
      },
      documentJson: JSON.stringify(result.document),
    };
  });

export const wbahPipelineToAutomationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      pipeline: z.object({
        name: z.string(),
        executor: z.literal("webee_native").optional(),
        retell_agents: z.array(z.string()),
        steps: z.array(
          z.object({
            id: z.string(),
            type: z.string(),
            enabled: z.boolean(),
          }),
        ),
        n8n_graph: z
          .object({
            nodes: z.array(
              z.object({
                id: z.string(),
                label: z.string().optional(),
                enabled: z.boolean().optional(),
                position: z.object({ x: z.number(), y: z.number() }),
              }),
            ),
            edges: z.array(
              z.object({
                id: z.string(),
                source: z.string(),
                target: z.string(),
              }),
            ),
          })
          .optional(),
      }),
    }),
  )
  .handler(async ({ data, context }) => {
    await assertSystemMindView(context as any);
    const { wbahPipelineToAutomationDocument, parseWorkflowDocument, ensureAutomationEngineBootstrapped } =
      await import("@/lib/automation-engine");
    ensureAutomationEngineBootstrapped();
    const document = wbahPipelineToAutomationDocument(data.pipeline as any);
    const validation = parseWorkflowDocument(document);
    return {
      documentJson: JSON.stringify(document),
      validation: {
        valid: validation.ok,
        errors: validation.ok ? [] : validation.errors,
      },
    };
  });

export const runAutomationWorkflowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      workflow: z.unknown(),
      trigger: z.record(z.unknown()).optional(),
      dryRun: z.boolean().optional(),
      maxNodes: z.number().int().min(1).max(500).optional(),
      persist: z.boolean().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    await assertSystemMindView(context as any);
    const {
      executeWorkflow,
      simulateWorkflow,
      executionSummary,
      ensureAutomationEngineBootstrapped,
    } = await import("@/lib/automation-engine");
    ensureAutomationEngineBootstrapped();
    const result = data.dryRun
      ? await simulateWorkflow(data.workflow, {
          trigger: data.trigger,
          maxNodes: data.maxNodes,
          workspaceId: (context as any).workspaceId,
        })
      : await executeWorkflow(data.workflow, {
          trigger: data.trigger,
          maxNodes: data.maxNodes,
          workspaceId: (context as any).workspaceId,
        });

    let persisted = false;
    let persistenceError: string | null = null;
    const workspaceId = (context as any).workspaceId as string | undefined;
    if (workspaceId && data.persist !== false) {
      try {
        const { persistWorkflowExecution } = await import(
          "@/lib/automation-engine/persistence/execution-persistence.server"
        );
        await persistWorkflowExecution({
          workspaceId,
          result,
          source: data.dryRun ? "dry_run" : "manual",
          trigger: data.trigger,
        });
        persisted = true;
      } catch (e) {
        persistenceError = e instanceof Error ? e.message : String(e);
      }
    }

    const summary = executionSummary(result);
    return {
      executionId: result.executionId,
      workflowId: result.workflowId,
      workflowName: result.workflowName,
      status: result.status,
      summary,
      log: result.log.map((entry) => ({
        nodeId: entry.nodeId,
        nodeType: entry.nodeType,
        nodeName: entry.nodeName,
        status: entry.status,
        startedAt: entry.startedAt,
        finishedAt: entry.finishedAt ?? null,
        branch: entry.branch ?? null,
        error: entry.error ?? null,
        outputJson: entry.output ? JSON.stringify(entry.output) : null,
      })),
      lastError: result.lastError ?? null,
      waitingOn: result.waitingOn
        ? {
            type: result.waitingOn.type,
            token: result.waitingOn.token,
            until: result.waitingOn.until ?? null,
            metadataJson: result.waitingOn.metadata ? JSON.stringify(result.waitingOn.metadata) : null,
          }
        : null,
      outputJson: result.output ? JSON.stringify(result.output) : null,
      persisted,
      persistenceError,
    };
  });

export const listAutomationExecutionsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(
    z
      .object({
        limit: z.number().int().min(1).max(200).optional(),
        source: z.enum(["manual", "dry_run", "webhook", "queue"]).optional(),
      })
      .optional(),
  )
  .handler(async ({ data, context }) => {
    await assertSystemMindView(context as any);
    const { listAutomationExecutions } = await import(
      "@/lib/automation-engine/persistence/execution-persistence.server"
    );
    const rows = await listAutomationExecutions((context as any).workspaceId, {
      limit: data?.limit ?? 50,
      source: data?.source,
    });
    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspaceId,
      workflowId: r.workflowId,
      wbahJobId: r.wbahJobId,
      workflowName: r.workflowName,
      source: r.source,
      status: r.status,
      nodeCount: r.nodeCount,
      nodesSucceeded: r.nodesSucceeded,
      nodesFailed: r.nodesFailed,
      lastError: r.lastError,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      summaryJson: JSON.stringify(r.summary),
    }));
  });

export const getAutomationExecutionFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ executionId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    await assertSystemMindView(context as any);
    const { getAutomationExecutionWithSteps } = await import(
      "@/lib/automation-engine/persistence/execution-persistence.server"
    );
    const detail = await getAutomationExecutionWithSteps(
      (context as any).workspaceId,
      data.executionId,
    );
    if (!detail) throw new Error("Execution not found");
    return {
      execution: {
        id: detail.execution.id,
        workflowId: detail.execution.workflowId,
        wbahJobId: detail.execution.wbahJobId,
        workflowName: detail.execution.workflowName,
        source: detail.execution.source,
        status: detail.execution.status,
        nodeCount: detail.execution.nodeCount,
        nodesSucceeded: detail.execution.nodesSucceeded,
        nodesFailed: detail.execution.nodesFailed,
        lastError: detail.execution.lastError,
        startedAt: detail.execution.startedAt,
        completedAt: detail.execution.completedAt,
        summaryJson: JSON.stringify(detail.execution.summary),
      },
      steps: detail.steps.map((s) => ({
        id: s.id,
        sequenceNum: s.sequenceNum,
        nodeId: s.nodeId,
        nodeType: s.nodeType,
        nodeName: s.nodeName,
        status: s.status,
        branch: s.branch,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        error: s.error,
      })),
    };
  });

export const getAutomationEngineCatalogFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSystemMindView(context as any);
    const { ensureAutomationEngineBootstrapped, getNodeRegistrySnapshot, CORE_NODE_DEFINITIONS, WBAH_NODE_DEFINITIONS } =
      await import("@/lib/automation-engine");
    ensureAutomationEngineBootstrapped();
    return {
      registry: getNodeRegistrySnapshot(),
      coreNodes: CORE_NODE_DEFINITIONS.map((n) => ({
        type: n.type,
        displayName: n.displayName,
        category: n.category,
        description: n.description,
      })),
      wbahNodes: WBAH_NODE_DEFINITIONS.map((n) => ({
        type: n.type,
        displayName: n.displayName,
        category: n.category,
        description: n.description,
      })),
      phase: 5,
      capabilities: [
        "workflow_json_schema",
        "parse_and_validate",
        "node_registry",
        "wbah_graph_adapter",
        "expression_resolver",
        "core_node_executors",
        "execution_runner",
        "execution_modes_manual_test_production",
        "execute_from_node",
        "execute_branch_only",
        "dry_run_simulation",
        "incremental_step_persistence",
        "execution_snapshots",
        "webhook_resume",
        "delay_resume",
        "execution_queue",
        "live_sse_events",
        "execution_history",
        "wbah_native_step_plugins",
      ],
      upcoming: ["parallel_branches", "workflow_versioning", "full_engine_cutover"],
    };
  });
