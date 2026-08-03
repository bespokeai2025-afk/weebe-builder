/**
 * Record automation-engine node trace for a WBAH post-call queue job.
 */
import { resolveWbahPostCallWorkflowConfig } from "@/lib/wbah/workflow/wbah-workflow-resolver.server";
import { attachAutomationToWbahPipeline } from "../sync-automation.server";
import { wbahPipelineToAutomationDocument } from "../adapters/wbah-graph.adapter";
import { executeWorkflowWithPersistence } from "../executor/execute-with-persistence";

export async function recordAutomationTraceForWbahJob(args: {
  workspaceId: string;
  jobId: string;
  agentId: string;
  payload: Record<string, unknown>;
}): Promise<{ executionId: string | null; persisted: boolean }> {
  try {
    const cfg = await resolveWbahPostCallWorkflowConfig({
      workspaceId: args.workspaceId,
      agentId: args.agentId,
    });
    const withAutomation = cfg.automation
      ? cfg
      : attachAutomationToWbahPipeline(cfg);
    const workflowDoc =
      (withAutomation.automation as Record<string, unknown> | undefined) ??
      wbahPipelineToAutomationDocument(withAutomation);

    const result = await executeWorkflowWithPersistence(workflowDoc, {
      workspaceId: args.workspaceId,
      source: "queue",
      wbahJobId: args.jobId,
      trigger: args.payload,
      dryRun: true,
      maxNodes: 120,
    });

    return {
      executionId: result.executionId,
      persisted: result.persisted,
    };
  } catch (e) {
    console.warn("[automation-engine] WBAH trace failed:", e);
    return { executionId: null, persisted: false };
  }
}
