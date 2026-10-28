/**
 * WBAH post-call — entry point for every Retell event on a WBAH agent.
 *
 * New-lead, TTC and DQ calls run one pipeline: the automation engine executes the workspace's
 * post-call workflow (the canvas in the WBAH workflow tab), node by node, with every step
 * implemented once in `automation-engine/plugins/wbah/wbah-step-handlers.server.ts`.
 *
 * There used to be a second, hand-written copy of the same steps here, chosen by
 * WBAH_USE_AUTOMATION_ENGINE. Production ran the engine, so every fix had to land twice, and three
 * times in October 2026 it landed in only one (call variables, repeated Dynamics writes, contact
 * address) and became a live bug. This file now only decides whether and how a call is processed:
 * web calls are ignored, rebooking agents use their own opportunity-only pipeline, and
 * WBAH_POST_CALL_ENABLED=false limits processing to the live transcript.
 */
import { handleWbahLiveTranscript } from "./wbah-live-transcript.server";
import { isWbahCalendlyConfigured } from "./wbah-calendly.server";
import { isWbahDynamicsConfigured } from "./wbah-dynamics.server";
import {
  isWbahPostCallExecutionEnabled,
  type WbahRetellAgentMapping,
} from "./wbah-retell-agents.shared";
import { extractDynVars } from "./wbah-dyn-vars.shared";

type RetellCall = {
  call_id?: string;
  agent_id?: string;
  call_type?: string;
  call_status?: string;
  from_number?: string;
  to_number?: string;
  direction?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  transcript?: string;
  recording_url?: string;
  call_analysis?: {
    call_summary?: string;
    user_sentiment?: string;
    custom_analysis_data?: Record<string, unknown>;
  };
  retell_llm_dynamic_variables?: Record<string, unknown>;
  collected_dynamic_variables?: Record<string, unknown>;
};

export type WbahPostCallProcessInput = {
  event: string;
  call: RetellCall;
  payload: Record<string, unknown>;
  agent: WbahRetellAgentMapping;
  /**
   * Step ids to force off for this run only, without touching the saved
   * workflow. A manual rerun uses this to hold back steps that are not safe to
   * repeat — `calendly_invitee` books a real appointment and would book a
   * second one. Applied by flipping `enabled` on the resolved config before
   * the workflow runs.
   */
  disabledStepIds?: string[];
};

export type WbahPostCallProcessResult = {
  handled: boolean;
  message: string;
  branches: string[];
  errors: string[];
};

export { extractDynVars } from "./wbah-dyn-vars.shared";

/** Kept for callers and docs that name the old function; the engine is the only pipeline. */
export async function runWbahPostCallPipeline(
  input: WbahPostCallProcessInput,
): Promise<WbahPostCallProcessResult> {
  return runWbahPostCallPipelineCore(input);
}

export async function runWbahPostCallPipelineCore(
  input: WbahPostCallProcessInput & { skipLiveTranscript?: boolean; wbahJobId?: string },
): Promise<WbahPostCallProcessResult> {
  const { event, call, payload, agent, skipLiveTranscript, disabledStepIds } = input;

  const isWebCall = call.call_type === "web_call" || call.call_type === "webcall";
  if (isWebCall) {
    return { handled: true, message: "ignored: web call", branches: [], errors: [] };
  }

  const { resolveWbahPostCallWorkflowConfig } = await import(
    "@/lib/wbah/workflow/wbah-workflow-resolver.server"
  );
  const { applyDisabledStepIds, isStepEnabledInOrder } = await import(
    "@/lib/wbah/workflow/wbah-workflow-graph.shared"
  );
  const wfConfig = applyDisabledStepIds(
    await resolveWbahPostCallWorkflowConfig({
      workspaceId: agent.workspaceId,
      agentId: String(call.agent_id ?? ""),
    }),
    disabledStepIds,
  );

  if (agent.role === "rebooking" || wfConfig.workflow_kind === "wbah_rebook_post_call") {
    const { runWbahRebookPostCallPipeline } = await import("./wbah-rebook-post-call.server");
    const { defaultRebookPostCallWorkflowConfig } = await import(
      "@/lib/wbah/workflow/wbah-rebook-workflow.shared"
    );
    const rebookConfig =
      wfConfig.workflow_kind === "wbah_rebook_post_call"
        ? wfConfig
        : defaultRebookPostCallWorkflowConfig({ retell_agents: wfConfig.retell_agents });
    return runWbahRebookPostCallPipeline({
      event,
      call,
      payload,
      agent,
      wfConfig: rebookConfig,
      skipLiveTranscript,
    });
  }

  if (!isWbahPostCallExecutionEnabled()) {
    const branches: string[] = [];
    const errors: string[] = [];
    if (!skipLiveTranscript && isStepEnabledInOrder(wfConfig, "live_transcript", event)) {
      try {
        await handleWbahLiveTranscript(event, call, payload, agent);
        branches.push("live_transcript");
      } catch (e) {
        errors.push(`live_transcript: ${(e as Error).message}`);
      }
    }
    return { handled: true, message: "live only (WBAH_POST_CALL_ENABLED=false)", branches, errors };
  }

  const { runWbahPostCallWorkflow } = await import(
    "@/lib/automation-engine/plugins/wbah/wbah-automation-pipeline.server"
  );
  return runWbahPostCallWorkflow({ ...input, wfConfig });
}

export function getWbahPostCallReadiness(): {
  executionEnabled: boolean;
  dynamics: boolean;
  calendly: boolean;
  webespoke: boolean;
} {
  return {
    executionEnabled: isWbahPostCallExecutionEnabled(),
    dynamics: isWbahDynamicsConfigured(),
    calendly: isWbahCalendlyConfigured(),
    webespoke: true,
  };
}

/** Entry point from retell-webhook.processor — returns null if agent is not WBAH. */
export async function processWbahRetellWebhook(input: {
  event: string;
  call: RetellCall;
  payload: Record<string, unknown>;
  incomingAgentId: string;
}): Promise<{
  ok: boolean;
  status: number;
  message: string;
  event?: string;
  callId?: string;
  workspaceId?: string;
  queued?: boolean;
} | null> {
  const { resolveWbahRetellAgent } = await import("./wbah-retell-agents.shared");
  const agent = resolveWbahRetellAgent(input.incomingAgentId);
  if (!agent) return null;

  const { resolveWbahPostCallWorkflowConfig } = await import(
    "@/lib/wbah/workflow/wbah-workflow-resolver.server"
  );
  const { isStepEnabledInOrder } = await import("@/lib/wbah/workflow/wbah-workflow-graph.shared");
  const wfConfig = await resolveWbahPostCallWorkflowConfig({
    workspaceId: agent.workspaceId,
    agentId: String(input.call.agent_id ?? input.incomingAgentId),
  });

  if (isStepEnabledInOrder(wfConfig, "live_transcript", input.event)) {
    try {
      await handleWbahLiveTranscript(input.event, input.call as Record<string, unknown>, input.payload, agent);
    } catch (e) {
      console.warn("[WBAH POST-CALL] live_transcript:", (e as Error).message);
    }
  }

  const dynVars = extractDynVars(input.call, input.payload);
  const leadId = String(dynVars.lead_id ?? dynVars.leadId ?? "").trim() || null;

  const { isWbahPostCallQueueEnabled, enqueueWbahPostCallJob, drainWbahPostCallQueueAsync } =
    await import("./wbah-post-call-queue.server");

  const queueable =
    isWbahPostCallQueueEnabled() &&
    isWbahPostCallExecutionEnabled() &&
    (input.event === "call_analyzed" ||
      input.event === "call_started" ||
      input.event === "call_ended");

  if (queueable) {
    const { jobId } = await enqueueWbahPostCallJob({
      workspaceId: agent.workspaceId,
      retellCallId: input.call.call_id ?? null,
      leadId,
      event: input.event,
      agentId: input.incomingAgentId,
      payload: input.payload,
    });
    drainWbahPostCallQueueAsync(jobId);
    return {
      ok: true,
      status: 200,
      message: jobId ? "queued" : "deduped",
      event: input.event,
      callId: input.call.call_id,
      workspaceId: agent.workspaceId,
      queued: !!jobId,
    };
  }

  const result = await runWbahPostCallPipelineCore({
    event: input.event,
    call: input.call,
    payload: input.payload,
    agent,
    skipLiveTranscript: true,
  });

  return {
    ok: true,
    status: 200,
    message: result.message,
    event: input.event,
    callId: input.call.call_id,
    workspaceId: agent.workspaceId,
    queued: false,
  };
}
