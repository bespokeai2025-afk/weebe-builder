/**
 * WBAH post-call workflow step catalog — n8n branch parity for SystemMind Build.
 */

export const WBAH_N8N_BRANCH_LABELS: Record<string, string> = {
  dashboard_analyzed: "Format slot → Calendly → POST dashboard with booking fields.",
  dynamics_allens: "Allen's Logic V5 → Dynamics status + appointment PATCH.",
  dynamics_agentic: "structured_json_output → normalize → Dynamics property PATCH.",
  lifecycle_raw: "POST raw call payload on call_started / call_ended.",
  webee_live: "Live transcript panel ingest.",
  rebook_dynamics: "Format rebook fields → PATCH /opportunities({id}) → timeline note.",
  rebook_dashboard: "POST call result to dashboard — no Calendly.",
};

export const WBAH_POST_CALL_STEP_TYPES = [
  "wbah_live_transcript",
  "wbah_dashboard_raw",
  "wbah_dashboard_analyzed",
  "wbah_calendly_link",
  "wbah_calendly_invitee",
  "wbah_calls_upsert",
  "wbah_dynamics_allens",
  "wbah_dynamics_agentic",
  "wbah_dynamics_rebook_opportunity",
  "wbah_dynamics_rebook_note",
] as const;

export type WbahPostCallStepType = (typeof WBAH_POST_CALL_STEP_TYPES)[number];

export type WbahPostCallStepDef = {
  id: string;
  type: WbahPostCallStepType;
  title: string;
  summary: string;
  /** Which Retell events run this step */
  events: Array<"call_started" | "call_ended" | "call_analyzed" | "any">;
  defaultEnabled: boolean;
  /** n8n branch id for docs */
  n8nBranchId?: string;
};

const BRANCH_SUMMARY: Record<string, string> = WBAH_N8N_BRANCH_LABELS;

export const WBAH_POST_CALL_STEP_CATALOG: WbahPostCallStepDef[] = [
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
    summary: BRANCH_SUMMARY.lifecycle_raw ?? "POST raw call payload to UAT dashboard.",
    events: ["call_started", "call_ended"],
    defaultEnabled: true,
    n8nBranchId: "lifecycle_raw",
  },
  {
    id: "calendly_link",
    type: "wbah_calendly_link",
    title: "Calendly booking link",
    summary: "Create Calendly link + slot deep-link when booking slot extracted.",
    events: ["call_analyzed"],
    defaultEnabled: true,
    n8nBranchId: "dashboard_analyzed",
  },
  {
    id: "calendly_invitee",
    type: "wbah_calendly_invitee",
    title: "Calendly auto-book invitee",
    summary: "After confirmed slot: random delay → POST Calendly /invitees with Q&A.",
    events: ["call_analyzed"],
    defaultEnabled: true,
    n8nBranchId: "calendly_invitee",
  },
  {
    id: "dashboard_analyzed",
    type: "wbah_dashboard_analyzed",
    title: "Dashboard analyzed POST",
    summary: BRANCH_SUMMARY.dashboard_analyzed ?? "POST call-output-data/create with booking fields.",
    events: ["call_analyzed"],
    defaultEnabled: true,
    n8nBranchId: "dashboard_analyzed",
  },
  {
    id: "wbah_calls_upsert",
    type: "wbah_calls_upsert",
    title: "WEBEE Calls tab upsert",
    summary: "Upsert call row in WEBEE Calls for reporting.",
    events: ["call_ended", "call_analyzed"],
    defaultEnabled: true,
  },
  {
    id: "dynamics_allens",
    type: "wbah_dynamics_allens",
    title: "Dynamics — Allen's Logic",
    summary: BRANCH_SUMMARY.dynamics_allens ?? "Status + appointment + callback PATCH.",
    events: ["call_analyzed"],
    defaultEnabled: true,
    n8nBranchId: "dynamics_allens",
  },
  {
    id: "dynamics_agentic",
    type: "wbah_dynamics_agentic",
    title: "Dynamics — property fields",
    summary: BRANCH_SUMMARY.dynamics_agentic ?? "structured_json_output → Dynamics PATCH.",
    events: ["call_analyzed"],
    defaultEnabled: true,
    n8nBranchId: "dynamics_agentic",
  },
];

export type WbahWorkflowStepConfig = {
  id: string;
  type: WbahPostCallStepType;
  title?: string;
  enabled: boolean;
  next?: string;
};

import type { WbahN8nWorkflowGraph } from "./wbah-n8n-node-catalog.shared";
import { defaultWbahN8nGraph, emptyWbahN8nGraph } from "./wbah-n8n-node-catalog.shared";

export type WbahPostCallWorkflowConfig = {
  name: string;
  purpose?: string;
  executor: "webee_native";
  retell_agents: string[];
  steps: WbahWorkflowStepConfig[];
  /** Full n8n-style graph (canvas positions, labels, custom nodes) */
  n8n_graph?: WbahN8nWorkflowGraph;
  /** Canonical automation engine document (generated on save, Phase 1) */
  automation?: Record<string, unknown>;
  automation_validation?: {
    valid: boolean;
    errors: string[];
    validated_at: string;
  };
  /** Allen's Logic branch conditions (SystemMind-editable) */
  allens_branch?: {
    conditions: Array<{
      field: string;
      op: "equals" | "not_equals" | "contains";
      value: string;
      status: string;
    }>;
  };
  /** general = copilot-built from scratch; wbah_post_call = New Leads; wbah_rebook_post_call = Rebook Opportunity */
  workflow_kind?: "general" | "wbah_post_call" | "wbah_rebook_post_call";
  /** Requirements surfaced by copilot (env var names, links — never secrets) */
  copilot_requirements?: {
    env_vars?: Array<{ name: string; description: string; example?: string }>;
    links?: Array<{ label: string; description: string; example?: string }>;
    credentials?: string[];
  };
};

export function defaultWbahPostCallWorkflowConfig(
  overrides: Partial<WbahPostCallWorkflowConfig> = {},
): WbahPostCallWorkflowConfig {
  const steps: WbahWorkflowStepConfig[] = WBAH_POST_CALL_STEP_CATALOG.map((s, i, arr) => ({
    id: s.id,
    type: s.type,
    title: s.title,
    enabled: s.defaultEnabled,
    next: i < arr.length - 1 ? arr[i + 1]!.id : undefined,
  }));
  return {
    name: "WBAH Retell Post-Call",
    purpose: "Native WEBEE post-call pipeline (replaces n8n yR3vAIdZNLovD8jx).",
    executor: "webee_native",
    retell_agents: [],
    steps,
    n8n_graph: defaultWbahN8nGraph(),
    ...overrides,
  };
}

/** Blank workflow for “New workflow” — no executor steps, canvas shows webhook only. */
export function emptyWbahPostCallWorkflowConfig(
  overrides: Partial<WbahPostCallWorkflowConfig> = {},
): WbahPostCallWorkflowConfig {
  return {
    name: "Untitled workflow",
    purpose: "",
    executor: "webee_native",
    retell_agents: [],
    steps: [],
    workflow_kind: "general",
    n8n_graph: emptyWbahN8nGraph(),
    ...overrides,
  };
}

export function wbahStepsToFlowDefinition(cfg: WbahPostCallWorkflowConfig): {
  steps: Array<Record<string, unknown>>;
} {
  const enabled = cfg.steps.filter((s) => s.enabled);
  const flowSteps: Array<Record<string, unknown>> = [
    {
      id: "step-trigger",
      type: "trigger",
      title: "Retell webhook",
      next: enabled[0]?.id ?? "step-stop",
    },
  ];
  for (let i = 0; i < enabled.length; i++) {
    const s = enabled[i]!;
    flowSteps.push({
      id: s.id,
      type: s.type,
      title: s.title ?? s.type,
      enabled: true,
      next: enabled[i + 1]?.id ?? "step-stop",
    });
  }
  flowSteps.push({ id: "step-stop", type: "stop_workflow", title: "Done" });
  return { steps: flowSteps };
}

export function flowDefinitionToWbahConfig(
  flow: Record<string, unknown> | null | undefined,
  triggerConfig: Record<string, unknown> | null | undefined,
): WbahPostCallWorkflowConfig | null {
  const rawSteps = ((flow as any)?.steps ?? []) as Array<Record<string, unknown>>;
  const wbahSteps = rawSteps.filter((s) =>
    WBAH_POST_CALL_STEP_TYPES.includes(String(s.type) as WbahPostCallStepType),
  );
  if (!wbahSteps.length) {
    const fromChannel = (flow as any)?.wbah_post_call ?? (triggerConfig as any)?.wbah_post_call;
    if (fromChannel && typeof fromChannel === "object") {
      return fromChannel as WbahPostCallWorkflowConfig;
    }
    return null;
  }
  const catalogById = Object.fromEntries(WBAH_POST_CALL_STEP_CATALOG.map((c) => [c.id, c]));
  const catalogByType = Object.fromEntries(WBAH_POST_CALL_STEP_CATALOG.map((c) => [c.type, c]));
  const steps: WbahWorkflowStepConfig[] = wbahSteps.map((s) => {
    const id = String(s.id);
    const type = String(s.type) as WbahPostCallStepType;
    const cat = catalogById[id] ?? catalogByType[type];
    return {
      id: cat?.id ?? id,
      type: cat?.type ?? type,
      title: String(s.title ?? cat?.title ?? type),
      enabled: s.enabled !== false,
      next: s.next ? String(s.next) : undefined,
    };
  });
  const agents = (triggerConfig?.retell_agents ?? triggerConfig?.retell_agent_ids ?? []) as string[];
  return {
    name: String((flow as any)?.name ?? "WBAH Post-Call"),
    purpose: String((flow as any)?.purpose ?? ""),
    executor: "webee_native",
    retell_agents: Array.isArray(agents) ? agents.map(String) : [],
    steps,
    allens_branch: (flow as any)?.allens_branch,
  };
}

export function isStepEnabled(
  cfg: WbahPostCallWorkflowConfig,
  stepId: string,
): boolean {
  const row = cfg.steps.find((s) => s.id === stepId || s.type === stepId);
  return row?.enabled !== false;
}

/** Reverse-map pipeline config → wizard answer keys (Build session editor). */
export function wbahPipelineToWizardAnswers(
  pipeline: WbahPostCallWorkflowConfig,
): Record<string, string | boolean | string[]> {
  return {
    workflow_name: pipeline.name,
    purpose: pipeline.purpose ?? "",
    retell_agents: pipeline.retell_agents,
    enable_live_transcript: isStepEnabled(pipeline, "live_transcript"),
    enable_dashboard:
      isStepEnabled(pipeline, "dashboard_raw") || isStepEnabled(pipeline, "dashboard_analyzed"),
    enable_calendly: isStepEnabled(pipeline, "calendly_link"),
    enable_calendly_invitee: isStepEnabled(pipeline, "calendly_invitee"),
    enable_dynamics_status: isStepEnabled(pipeline, "dynamics_allens"),
    enable_dynamics_property: isStepEnabled(pipeline, "dynamics_agentic"),
    enable_calls_tab: isStepEnabled(pipeline, "wbah_calls_upsert"),
  };
}
