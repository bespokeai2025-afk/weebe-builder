import type { WbahPostCallWorkflowConfig } from "@/lib/wbah/workflow/wbah-workflow-steps.shared";
import type { WbahN8nNodeConfig } from "@/lib/wbah/workflow/wbah-n8n-node-presets.shared";

export type ExecuteWbahNodeStepResult = {
  nodeId: string;
  status: "success" | "error" | "waiting";
  input: Array<{ json: Record<string, unknown> }>;
  output: Array<{ json: Record<string, unknown> }>;
  error: string | null;
  branch: string | null;
};

export function applyNodeExecutionToPipeline(
  pipeline: WbahPostCallWorkflowConfig,
  nodeId: string,
  exec: ExecuteWbahNodeStepResult,
): WbahPostCallWorkflowConfig {
  if (!pipeline.n8n_graph?.nodes?.length) return pipeline;

  return {
    ...pipeline,
    n8n_graph: {
      ...pipeline.n8n_graph,
      nodes: pipeline.n8n_graph.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const prev = (n.config ?? {}) as WbahN8nNodeConfig;
        return {
          ...n,
          config: {
            ...prev,
            lastExecution: {
              input: exec.input,
              output: exec.output,
              status: exec.status === "waiting" ? "skipped" : exec.status,
              at: new Date().toISOString(),
            },
          },
        };
      }),
    },
  };
}
