/**
 * Run WBAH post-call via automation engine (Phase 4 — opt-in).
 */
import type { WbahPostCallProcessInput, WbahPostCallProcessResult } from "@/lib/wbah/post-call/wbah-post-call.server";
import { resolveWbahPostCallWorkflowConfig } from "@/lib/wbah/workflow/wbah-workflow-resolver.server";
import { attachAutomationToWbahPipeline } from "../../sync-automation.server";
import { wbahPipelineToAutomationDocument } from "../../adapters/wbah-graph.adapter";
import { executeWorkflowWithPersistence } from "../../executor/execute-with-persistence";
import { ensureAutomationEngineBootstrapped } from "../../bootstrap";

export function isWbahAutomationEngineEnabled(): boolean {
  const v = process.env.WBAH_USE_AUTOMATION_ENGINE ?? "false";
  return v === "true" || v === "1";
}

export async function runWbahPostCallViaAutomationEngine(
  input: WbahPostCallProcessInput & { skipLiveTranscript?: boolean; wbahJobId?: string },
): Promise<WbahPostCallProcessResult> {
  ensureAutomationEngineBootstrapped();

  const cfg = await resolveWbahPostCallWorkflowConfig({
    workspaceId: input.agent.workspaceId,
    agentId: String(input.call.agent_id ?? ""),
  });
  const withAutomation = cfg.automation ? cfg : attachAutomationToWbahPipeline(cfg);
  const workflowDoc =
    (withAutomation.automation as Record<string, unknown> | undefined) ??
    wbahPipelineToAutomationDocument(withAutomation);

  const trigger = {
    event: input.event,
    call: input.call,
    body: { event: input.event, call: input.call, ...input.payload },
    ...input.payload,
  };

  const result = await executeWorkflowWithPersistence(workflowDoc, {
    workspaceId: input.agent.workspaceId,
    source: "queue",
    wbahJobId: input.wbahJobId ?? null,
    trigger,
    dryRun: false,
    maxNodes: 150,
  });

  const branches: string[] = [];
  const errors: string[] = [];

  for (const entry of result.log) {
    const step = (entry.output as Record<string, unknown> | undefined)?._wbahStep;
    if (typeof step === "string" && entry.status === "success") {
      const out = entry.output as Record<string, unknown> | undefined;
      if (out?._wbahSkipped) continue;
      branches.push(step);
    }
    if (entry.status === "error" && entry.error) {
      errors.push(`${entry.nodeId}: ${entry.error}`);
    }
  }

  if (result.lastError) errors.push(result.lastError);

  return {
    handled: true,
    message: errors.length ? "completed with errors (automation engine)" : "completed (automation engine)",
    branches,
    errors,
  };
}
