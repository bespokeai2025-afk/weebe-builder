/**
 * WBAH plugin — register native post-call node types.
 */
import type { NodeDefinition } from "../../types/node.types";
import { registerNodes } from "../../registry/node-registry";
import {
  executeWbahCalendlyInvitee,
  executeWbahCalendlyLink,
  executeWbahCallsUpsert,
  executeWbahDashboardAnalyzed,
  executeWbahDashboardRaw,
  executeWbahDynamicsAgentic,
  executeWbahDynamicsAllens,
  executeWbahFormatData,
  executeWbahLiveTranscript,
  executeWbahStepById,
} from "./wbah-node-executors.server";
import { mergeWbahOutput } from "./wbah-run-context";
import { isTransientError } from "../../runtime/node-runtime";

export const WBAH_NODE_DEFINITIONS: NodeDefinition[] = [
  {
    version: 1,
    type: "wbah.live_transcript",
    displayName: "WBAH Live Transcript",
    category: "action",
    description: "Stream transcript to WEBEE live panel.",
    inputs: [{ name: "main", type: "main" }],
    outputs: [{ name: "main", type: "main" }],
    execute: executeWbahLiveTranscript,
  },
  {
    version: 1,
    type: "wbah.dashboard_raw",
    displayName: "WBAH Dashboard Raw",
    category: "action",
    description: "POST raw call payload on call_started / call_ended.",
    inputs: [{ name: "main", type: "main", required: true }],
    outputs: [{ name: "main", type: "main" }],
    execute: executeWbahDashboardRaw,
  },
  {
    version: 1,
    type: "wbah.format_data",
    displayName: "WBAH Format Data",
    category: "action",
    description: "Parse Retell analysis into formatted booking/CRM fields.",
    inputs: [{ name: "main", type: "main", required: true }],
    outputs: [{ name: "main", type: "main" }],
    execute: executeWbahFormatData,
  },
  {
    version: 1,
    type: "wbah.calendly_link",
    displayName: "WBAH Calendly Link",
    category: "action",
    description: "Create Calendly scheduling link and slot URL.",
    inputs: [{ name: "main", type: "main", required: true }],
    outputs: [{ name: "main", type: "main" }],
    execute: executeWbahCalendlyLink,
  },
  {
    version: 1,
    type: "wbah.calendly_invitee",
    displayName: "WBAH Calendly Invitee",
    category: "action",
    description: "Auto-book Calendly invitee when appointment confirmed.",
    inputs: [{ name: "main", type: "main", required: true }],
    outputs: [{ name: "main", type: "main" }],
    execute: executeWbahCalendlyInvitee,
  },
  {
    version: 1,
    type: "wbah.dashboard_analyzed",
    displayName: "WBAH Dashboard Analyzed",
    category: "action",
    description: "POST call-output-data/create with booking fields.",
    inputs: [{ name: "main", type: "main", required: true }],
    outputs: [{ name: "main", type: "main" }],
    execute: executeWbahDashboardAnalyzed,
  },
  {
    version: 1,
    type: "wbah.calls_upsert",
    displayName: "WBAH Calls Upsert",
    category: "action",
    description: "Upsert WEBEE Calls tab row.",
    inputs: [{ name: "main", type: "main", required: true }],
    outputs: [{ name: "main", type: "main" }],
    execute: executeWbahCallsUpsert,
  },
  {
    version: 1,
    type: "wbah.dynamics_allens",
    displayName: "WBAH Dynamics Allen's Logic",
    category: "action",
    description: "Allen's Logic V5 to Dynamics status PATCH.",
    inputs: [{ name: "main", type: "main", required: true }],
    outputs: [{ name: "main", type: "main" }],
    execute: executeWbahDynamicsAllens,
  },
  {
    version: 1,
    type: "wbah.dynamics_agentic",
    displayName: "WBAH Dynamics Agentic",
    category: "action",
    description: "structured_json_output to Dynamics property PATCH.",
    inputs: [{ name: "main", type: "main", required: true }],
    outputs: [{ name: "main", type: "main" }],
    execute: executeWbahDynamicsAgentic,
  },
  {
    version: 1,
    type: "wbah.step",
    displayName: "WBAH Step (config)",
    category: "action",
    description: "Dispatches by config.executorStepId.",
    inputs: [{ name: "main", type: "main" }],
    outputs: [{ name: "main", type: "main" }],
    execute: executeWbahStepById,
  },
];

let wbahRegistered = false;

/**
 * A WBAH step the CRM or dashboard refuses (a Dynamics 400, say) is recorded and the run goes on.
 *
 * The steps are independent writes — Allen's Logic, the agentic PATCH, the timeline note, the
 * dashboard POST, the calls table. The hand-written pipeline ran each in its own try/catch; on the
 * engine one refusal stopped the run, so on call_d432d4a7887e6d9443e8dba836d a refused status
 * change also cost the call its note, its dashboard record and its row in wbah_calls. A temporary
 * failure still stops the run, so the queue retries the job (holding back steps that already ran).
 */
function recordFailureAndContinue(execute: NodeDefinition["execute"]): NodeDefinition["execute"] {
  return async (ctx) => {
    try {
      return await execute(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isTransientError(message)) throw err;
      console.warn(`[wbah-automation] ${ctx.nodeId} failed, continuing: ${message.slice(0, 200)}`);
      return { status: "success", output: { json: mergeWbahOutput(ctx, {}, { _wbahError: message }) } };
    }
  };
}

for (const def of WBAH_NODE_DEFINITIONS) def.execute = recordFailureAndContinue(def.execute);

export function registerWbahNodes(): void {
  if (wbahRegistered) return;
  registerNodes(WBAH_NODE_DEFINITIONS);
  wbahRegistered = true;
}

export const WBAH_EXECUTOR_STEP_TO_NODE_TYPE: Record<string, string> = {
  live_transcript: "wbah.live_transcript",
  dashboard_raw: "wbah.dashboard_raw",
  calendly_link: "wbah.calendly_link",
  calendly_invitee: "wbah.calendly_invitee",
  dashboard_analyzed: "wbah.dashboard_analyzed",
  wbah_calls_upsert: "wbah.calls_upsert",
  dynamics_allens: "wbah.dynamics_allens",
  dynamics_agentic: "wbah.dynamics_agentic",
  dynamics_rebook_opportunity: "wbah.step",
  dynamics_rebook_note: "wbah.step",
};

export const WBAH_CODE_HINT_TO_NODE_TYPE: Record<string, string> = {
  formatWbahRetellCallData: "wbah.format_data",
  buildWbahCalendlySlotUrl: "wbah.calendly_link",
};
