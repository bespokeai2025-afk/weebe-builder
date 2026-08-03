/**
 * Execute a single n8n canvas node (dry-run) + hydrate last execution I/O onto graph nodes.
 */
import { attachAutomationToWbahPipeline } from "@/lib/automation-engine/sync-automation.server";
import { parseWorkflowDocument } from "@/lib/automation-engine/parser/parse-workflow";
import { ensureAutomationEngineBootstrapped } from "@/lib/automation-engine/bootstrap";
import { getAutomationStepsForWbahJob } from "@/lib/automation-engine/persistence/execution-persistence.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { WbahPostCallWorkflowConfig } from "@/lib/wbah/workflow/wbah-workflow-steps.shared";
import type { WbahN8nNodeConfig } from "@/lib/wbah/workflow/wbah-n8n-node-presets.shared";
import {
  pinItemsFromJson,
  unwrapPinDataToJson,
  WBAH_DEFAULT_EXECUTE_TRIGGER,
} from "@/lib/wbah/workflow/wbah-test-trigger-fixture.shared";
import {
  applyNodeExecutionToPipeline,
  type ExecuteWbahNodeStepResult,
} from "@/lib/wbah/workflow/wbah-node-execution.shared";

export type { ExecuteWbahNodeStepResult };
export { applyNodeExecutionToPipeline };

export async function executeWbahWorkflowNodeStep(args: {
  pipeline: WbahPostCallWorkflowConfig;
  nodeId: string;
  pinData?: unknown;
  dryRun?: boolean;
}): Promise<ExecuteWbahNodeStepResult> {
  ensureAutomationEngineBootstrapped();

  const withAuto = attachAutomationToWbahPipeline(args.pipeline);
  const raw = withAuto.automation ?? {};
  const parsed = parseWorkflowDocument(raw);
  if (!parsed.ok) {
    throw new Error(`Workflow invalid: ${parsed.errors.join("; ")}`);
  }

  const node = parsed.workflow.nodes.get(args.nodeId);
  if (!node) {
    throw new Error(`Node "${args.nodeId}" not found in workflow`);
  }

  const pinJson = args.pinData != null ? unwrapPinDataToJson(args.pinData) : null;
  const trigger = (
    pinJson && Object.keys(pinJson).length > 0 ? pinJson : WBAH_DEFAULT_EXECUTE_TRIGGER
  ) as Record<string, unknown>;

  const { runExecution } = await import("@/lib/automation-engine/runtime/execution-runner");
  const result = await runExecution({
    workflow: withAuto.automation ?? {},
    mode: args.dryRun !== false ? "test" : "manual",
    startNodeId: args.nodeId,
    startInput: trigger,
    maxNodes: 1,
  });

  const step = result.log[0];
  const outJson = (step?.output ?? trigger) as Record<string, unknown>;
  const status =
    step?.status === "success"
      ? "success"
      : step?.status === "waiting"
        ? "waiting"
        : "error";

  return {
    nodeId: args.nodeId,
    status,
    input: pinItemsFromJson(trigger),
    output: pinItemsFromJson(outJson),
    error: step?.error ?? result.lastError ?? null,
    branch: step?.branch ?? null,
  };
}

export async function hydratePipelineFromLatestExecution(
  workspaceId: string,
  pipeline: WbahPostCallWorkflowConfig,
): Promise<WbahPostCallWorkflowConfig> {
  if (!pipeline.n8n_graph?.nodes?.length) return pipeline;

  const sb = supabaseAdmin as any;
  const { data: job } = await sb
    .from("wbah_post_call_jobs")
    .select("id, automation_execution_id, updated_at")
    .eq("workspace_id", workspaceId)
    .in("status", ["completed", "processing"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!job?.automation_execution_id && !job?.id) return pipeline;

  let steps: Awaited<ReturnType<typeof getAutomationStepsForWbahJob>> = [];
  if (job.automation_execution_id) {
    const { getAutomationExecutionWithSteps } = await import(
      "@/lib/automation-engine/persistence/execution-persistence.server"
    );
    const detail = await getAutomationExecutionWithSteps(
      workspaceId,
      String(job.automation_execution_id),
    );
    steps = detail?.steps ?? [];
  } else if (job.id) {
    steps = await getAutomationStepsForWbahJob(workspaceId, String(job.id));
  }

  if (!steps.length) return pipeline;

  const byNode = Object.fromEntries(steps.map((s) => [s.nodeId, s]));

  return {
    ...pipeline,
    n8n_graph: {
      ...pipeline.n8n_graph,
      nodes: pipeline.n8n_graph.nodes.map((n) => {
        const step = byNode[n.id];
        if (!step) return n;
        const prev = (n.config ?? {}) as WbahN8nNodeConfig;
        const out =
          step.outputMasked && Object.keys(step.outputMasked).length > 0
            ? [{ json: step.outputMasked }]
            : undefined;
        return {
          ...n,
          config: {
            ...prev,
            lastExecution: {
              output: out,
              status:
                step.status === "success"
                  ? "success"
                  : step.status === "error"
                    ? "error"
                    : "skipped",
              at: step.completedAt ?? step.startedAt,
            },
          },
        };
      }),
    },
  };
}
