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
};

export const WBAH_CODE_HINT_TO_NODE_TYPE: Record<string, string> = {
  formatWbahRetellCallData: "wbah.format_data",
  buildWbahCalendlySlotUrl: "wbah.calendly_link",
};
