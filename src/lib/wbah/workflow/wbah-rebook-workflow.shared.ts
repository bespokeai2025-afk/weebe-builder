/**
 * WBAH Rebook post-call workflow config — separate from New Leads (no Calendly, Opportunity-only Dynamics).
 */
import type { WbahPostCallStepDef, WbahPostCallWorkflowConfig, WbahWorkflowStepConfig } from "./wbah-workflow-steps.shared";
import { defaultWbahRebookN8nGraph, WBAH_REBOOK_RETELL_AGENTS } from "./wbah-rebook-n8n-node-catalog.shared";

export const WBAH_REBOOK_POST_CALL_STEP_TYPES = [
  "wbah_live_transcript",
  "wbah_dashboard_raw",
  "wbah_dashboard_analyzed",
  "wbah_calls_upsert",
  "wbah_dynamics_rebook_opportunity",
  "wbah_dynamics_rebook_note",
] as const;

export const WBAH_REBOOK_STEP_CATALOG: WbahPostCallStepDef[] = [
  {
    id: "live_transcript",
    type: "wbah_live_transcript",
    title: "Live transcript ingest",
    summary: "Stream transcript to WEBEE live panel on every event.",
    events: ["any"],
    defaultEnabled: true,
    n8nBranchId: "webee_live",
  },
  {
    id: "dashboard_raw",
    type: "wbah_dashboard_raw",
    title: "Dashboard raw (call started/ended)",
    summary: "POST raw call payload to UAT dashboard (opportunity id as record key).",
    events: ["call_started", "call_ended"],
    defaultEnabled: true,
    n8nBranchId: "lifecycle_raw",
  },
  {
    id: "dashboard_analyzed",
    type: "wbah_dashboard_analyzed",
    title: "Dashboard analyzed POST",
    summary: "POST call-output-data/create with call result — no Calendly fields.",
    events: ["call_analyzed"],
    defaultEnabled: true,
    n8nBranchId: "rebook_dashboard",
  },
  {
    id: "wbah_calls_upsert",
    type: "wbah_calls_upsert",
    title: "WEBEE Calls tab upsert",
    summary: "Upsert call row in WEBEE Calls for reporting.",
    events: ["call_analyzed"],
    defaultEnabled: true,
  },
  {
    id: "dynamics_rebook_opportunity",
    type: "wbah_dynamics_rebook_opportunity",
    title: "Dynamics — PATCH Opportunity",
    summary:
      "structured_json_output → PATCH /opportunities({id}). Never PATCH originating Lead.",
    events: ["call_analyzed"],
    defaultEnabled: true,
    n8nBranchId: "rebook_dynamics",
  },
  {
    id: "dynamics_rebook_note",
    type: "wbah_dynamics_rebook_note",
    title: "Dynamics — Opportunity timeline note",
    summary: "POST annotation with objectid_opportunity.",
    events: ["call_analyzed"],
    defaultEnabled: true,
    n8nBranchId: "rebook_dynamics",
  },
];

export function defaultRebookPostCallWorkflowConfig(
  overrides: Partial<WbahPostCallWorkflowConfig> = {},
): WbahPostCallWorkflowConfig {
  const steps: WbahWorkflowStepConfig[] = WBAH_REBOOK_STEP_CATALOG.map((s, i, arr) => ({
    id: s.id,
    type: s.type as WbahWorkflowStepConfig["type"],
    title: s.title,
    enabled: s.defaultEnabled,
    next: i < arr.length - 1 ? arr[i + 1]!.id : undefined,
  }));

  return {
    name: "WBAH Rebook Post-Call",
    purpose:
      "Rebook Initial Consultation — Dynamics Opportunity updates only. No Calendly, no Lead PATCH.",
    executor: "webee_native",
    retell_agents: [...WBAH_REBOOK_RETELL_AGENTS],
    steps,
    n8n_graph: defaultWbahRebookN8nGraph(),
    workflow_kind: "wbah_rebook_post_call",
    copilot_requirements: {
      env_vars: [
        {
          name: "DYNAMICS_TENANT_ID",
          description: "Dynamics OAuth tenant",
        },
        {
          name: "DYNAMICS_CLIENT_ID",
          description: "Dynamics app client id",
        },
        {
          name: "DYNAMICS_CLIENT_SECRET",
          description: "Dynamics app secret",
        },
      ],
      links: [
        {
          label: "Retell dynamic variables",
          description: "crm_type=opportunity, opportunity_id, optional originating_lead_id",
          example: "lead_id may hold opportunityid for legacy Rebook rows",
        },
      ],
    },
    ...overrides,
  };
}
