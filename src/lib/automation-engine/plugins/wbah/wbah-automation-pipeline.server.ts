/**
 * WBAH post-call workflow on the automation engine — the only post-call pipeline for new-lead,
 * TTC and DQ agents. Entry and gating live in wbah-post-call.server.ts.
 */
import type { WbahPostCallProcessInput, WbahPostCallProcessResult } from "@/lib/wbah/post-call/wbah-post-call.server";
import type { WbahPostCallWorkflowConfig } from "@/lib/wbah/workflow/wbah-workflow-steps.shared";
import { attachAutomationToWbahPipeline } from "../../sync-automation.server";
import { wbahPipelineToAutomationDocument } from "../../adapters/wbah-graph.adapter";
import { executeWorkflowWithPersistence } from "../../executor/execute-with-persistence";
import { ensureAutomationEngineBootstrapped } from "../../bootstrap";
import { isTransientError } from "../../runtime/node-runtime";

/**
 * The engine is the only WBAH post-call pipeline now (see wbah-post-call.server.ts), so this is
 * always true. WBAH_USE_AUTOMATION_ENGINE is no longer read; it can be removed from the server env.
 */
export function isWbahAutomationEngineEnabled(): boolean {
  return true;
}

/** Same entry as the queue and the webhook use: web-call, rebooking and kill-switch checks first. */
export async function runWbahPostCallViaAutomationEngine(
  input: WbahPostCallProcessInput & { skipLiveTranscript?: boolean; wbahJobId?: string },
): Promise<WbahPostCallProcessResult> {
  const { runWbahPostCallPipelineCore } = await import("@/lib/wbah/post-call/wbah-post-call.server");
  return runWbahPostCallPipelineCore(input);
}

/** Run the workspace's post-call workflow for one event. `wfConfig` already has per-run steps off. */
export async function runWbahPostCallWorkflow(
  input: WbahPostCallProcessInput & {
    skipLiveTranscript?: boolean;
    wbahJobId?: string;
    wfConfig: WbahPostCallWorkflowConfig;
  },
): Promise<WbahPostCallProcessResult> {
  ensureAutomationEngineBootstrapped();

  const cfg = input.wfConfig;
  const withAutomation = cfg.automation ? cfg : attachAutomationToWbahPipeline(cfg);
  const workflowDoc =
    (withAutomation.automation as Record<string, unknown> | undefined) ??
    wbahPipelineToAutomationDocument(withAutomation);

  const trigger = {
    event: input.event,
    call: input.call,
    body: { event: input.event, call: input.call, ...input.payload },
    ...input.payload,
    // The webhook already mirrored this event into the live session before queueing it.
    _skipLiveTranscript: Boolean(input.skipLiveTranscript),
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

  // A run stopped by a temporary failure (no answer, 429, 5xx) goes back to the queue, which
  // retries it with backoff. Anything else is final: a Dynamics validation error fails the same
  // way every time, so the job completes with the error shown instead of retrying it.
  const failedStep = [...result.log].reverse().find((e) => e.status === "error");
  if (result.status === "failed" && input.wbahJobId && failedStep?.error && isTransientError(failedStep.error)) {
    throw new Error(`${failedStep.nodeId}: ${failedStep.error}`);
  }

  return {
    handled: true,
    message: errors.length ? "completed with errors (automation engine)" : "completed (automation engine)",
    branches,
    errors,
  };
}
