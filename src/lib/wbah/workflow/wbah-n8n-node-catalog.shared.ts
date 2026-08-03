/**
 * Full n8n workflow node catalog — mirrors production WBAH post-call graph (yR3vAIdZNLovD8jx).
 * Used by React Flow canvas; executable steps map to WBAH_POST_CALL_STEP_CATALOG ids.
 */

export type WbahN8nNodeKind =
  | "trigger"
  | "filter"
  | "if"
  | "merge"
  | "code"
  | "http"
  | "wait"
  | "stop";

import type { WbahN8nNodeConfig } from "./wbah-n8n-node-presets.shared";
import { defaultN8nParamsForKind, mergeN8nNodeConfig } from "./wbah-n8n-node-presets.shared";
import { withDefaultCodeIfMissing } from "./wbah-n8n-code-snippets.shared";

export type WbahN8nNodeDef = {
  id: string;
  /** User-facing n8n node number from production workflow */
  n8nRef?: number;
  label: string;
  kind: WbahN8nNodeKind;
  branch: string;
  /** Coarse executor step that must be enabled for this node to run */
  executorStepId?: string;
  config?: WbahN8nNodeConfig;
  defaultPosition: { x: number; y: number };
};

export type WbahN8nGraphEdge = {
  id: string;
  source: string;
  target: string;
  /** n8n output branch: main | true | false | error */
  sourceHandle?: string;
};

export type WbahN8nNodeInstance = {
  id: string;
  label?: string;
  enabled?: boolean;
  config?: WbahN8nNodeDef["config"];
  position: { x: number; y: number };
};

export type WbahN8nWorkflowGraph = {
  nodes: WbahN8nNodeInstance[];
  edges: WbahN8nGraphEdge[];
};

/** Production n8n nodes — positions laid out in branch columns. */
export const WBAH_N8N_NODE_CATALOG: WbahN8nNodeDef[] = [
  {
    id: "webhook",
    label: "Webhook",
    kind: "trigger",
    branch: "entry",
    config: { summary: "Retell voice webhook ingress" },
    defaultPosition: { x: 40, y: 280 },
  },
  {
    id: "filter-lead-1",
    n8nRef: 1,
    label: "Filter — lead_id exists",
    kind: "filter",
    branch: "dashboard_analyzed",
    executorStepId: "dashboard_analyzed",
    config: { condition: "{{ $json.body.call.retell_llm_dynamic_variables.lead_id }} exists" },
    defaultPosition: { x: 280, y: 40 },
  },
  {
    id: "call-analyzed-dashboard",
    n8nRef: 7,
    label: "call_analyzed (dashboard)",
    kind: "if",
    branch: "dashboard_analyzed",
    executorStepId: "dashboard_analyzed",
    config: { condition: "{{ $json.body.event }} equals call_analyzed" },
    defaultPosition: { x: 520, y: 40 },
  },
  {
    id: "format-data",
    n8nRef: 9,
    label: "Format Data",
    kind: "code",
    branch: "dashboard_analyzed",
    executorStepId: "calendly_link",
    config: {
      summary: "Parse calendly_slot / available_slots, UK → UTC",
      codeHint: "formatWbahRetellCallData",
    },
    defaultPosition: { x: 760, y: 40 },
  },
  {
    id: "create-booking-link",
    n8nRef: 10,
    label: "Create Booking Link",
    kind: "http",
    branch: "dashboard_analyzed",
    executorStepId: "calendly_link",
    config: {
      method: "POST",
      url: "https://api.calendly.com/scheduling_links",
      summary: "Calendly scheduling_links (batch 1 / 2s)",
    },
    defaultPosition: { x: 1000, y: 40 },
  },
  {
    id: "build-slot-url",
    n8nRef: 11,
    label: "Build Slot URL",
    kind: "code",
    branch: "dashboard_analyzed",
    executorStepId: "calendly_link",
    config: { codeHint: "buildWbahCalendlySlotUrl" },
    defaultPosition: { x: 1240, y: 40 },
  },
  {
    id: "merge2",
    n8nRef: 8,
    label: "Merge2",
    kind: "merge",
    branch: "dashboard_analyzed",
    executorStepId: "dashboard_analyzed",
    config: { summary: "Combine: analyzed webhook + slot URL" },
    defaultPosition: { x: 1480, y: 40 },
  },
  {
    id: "post-dashboard-analyzed",
    n8nRef: 10,
    label: "POST TO DASHBOARD",
    kind: "http",
    branch: "dashboard_analyzed",
    executorStepId: "dashboard_analyzed",
    config: {
      method: "POST",
      url: "https://uat-api.webespokeai.com/call-output-data/create",
    },
    defaultPosition: { x: 1720, y: 40 },
  },
  {
    id: "filter-lead-2",
    n8nRef: 2,
    label: "Filter1 — lead_id",
    kind: "filter",
    branch: "dynamics_allens",
    executorStepId: "dynamics_allens",
    config: { condition: "{{ $json.body.call.retell_llm_dynamic_variables.lead_id }} exists" },
    defaultPosition: { x: 280, y: 200 },
  },
  {
    id: "call-analyzed-crm",
    n8nRef: 17,
    label: "call_analyzed (CRM)",
    kind: "if",
    branch: "dynamics_allens",
    executorStepId: "dynamics_allens",
    config: { condition: "{{ $json.body.event }} equals call_analyzed" },
    defaultPosition: { x: 520, y: 200 },
  },
  {
    id: "get-d365-token",
    n8nRef: 18,
    label: "GET D365 Token",
    kind: "http",
    branch: "dynamics_allens",
    executorStepId: "dynamics_allens",
    config: {
      summary: "OAuth2 client_credentials token for Dynamics 365",
    },
    defaultPosition: { x: 760, y: 200 },
  },
  {
    id: "merge-token",
    n8nRef: 19,
    label: "Merge token into data",
    kind: "code",
    branch: "dynamics_allens",
    executorStepId: "dynamics_allens",
    config: { codeHint: "accessToken forward" },
    defaultPosition: { x: 1000, y: 200 },
  },
  {
    id: "merge-token-data",
    n8nRef: 20,
    label: "Merge",
    kind: "merge",
    branch: "dynamics_allens",
    executorStepId: "dynamics_allens",
    config: { summary: "Token + lead extract" },
    defaultPosition: { x: 1240, y: 200 },
  },
  {
    id: "filter-lead-3",
    n8nRef: 3,
    label: "Filter2 — lead_id",
    kind: "filter",
    branch: "dynamics_allens",
    executorStepId: "dynamics_allens",
    config: { condition: "{{ $json.body.call.retell_llm_dynamic_variables.lead_id }} exists" },
    defaultPosition: { x: 280, y: 320 },
  },
  {
    id: "call-analyzed-calendly",
    n8nRef: 21,
    label: "Analyzed + Calendly slot",
    kind: "if",
    branch: "dynamics_allens",
    executorStepId: "dynamics_allens",
    config: { condition: "{{ $json.body.event }} equals call_analyzed" },
    defaultPosition: { x: 520, y: 320 },
  },
  {
    id: "webhook-extract",
    n8nRef: 22,
    label: "WebhookDataExtract",
    kind: "code",
    branch: "dynamics_allens",
    executorStepId: "dynamics_allens",
    config: { codeHint: "Build lead object + verified_details" },
    defaultPosition: { x: 760, y: 320 },
  },
  {
    id: "if-sentiment",
    n8nRef: 23,
    label: "If sentiment present",
    kind: "if",
    branch: "dynamics_allens",
    executorStepId: "dynamics_allens",
    config: { condition: "user_sentiment is not empty" },
    defaultPosition: { x: 1000, y: 320 },
  },
  {
    id: "forward-if-block",
    n8nRef: 24,
    label: "ForwardDataFromIfBlock",
    kind: "code",
    branch: "dynamics_allens",
    executorStepId: "dynamics_allens",
    defaultPosition: { x: 1240, y: 320 },
  },
  {
    id: "merge1",
    n8nRef: 12,
    label: "Merge1",
    kind: "merge",
    branch: "dynamics_allens",
    executorStepId: "dynamics_allens",
    config: { summary: "Token + lead + slot URL" },
    defaultPosition: { x: 1480, y: 260 },
  },
  {
    id: "get-lead-status",
    n8nRef: 13,
    label: "GET Lead Current Status",
    kind: "http",
    branch: "dynamics_allens",
    executorStepId: "dynamics_allens",
    config: {
      method: "GET",
      url: "Dynamics leads({{ lead_id }})?$select=new_currentstatus,statecode",
    },
    defaultPosition: { x: 1720, y: 200 },
  },
  {
    id: "apply-allens-logic",
    n8nRef: 14,
    label: "Apply Allens Logic V5",
    kind: "code",
    branch: "dynamics_allens",
    executorStepId: "dynamics_allens",
    config: { codeHint: "applyAllensLogicV5" },
    defaultPosition: { x: 1960, y: 200 },
  },
  {
    id: "build-crm-payload",
    n8nRef: 15,
    label: "Build CRM Payload",
    kind: "code",
    branch: "dynamics_allens",
    executorStepId: "dynamics_allens",
    config: { codeHint: "buildWbahAllensCrmPayload" },
    defaultPosition: { x: 2200, y: 200 },
  },
  {
    id: "patch-dynamics-allen",
    n8nRef: 16,
    label: "POST SUMMARY TO 365",
    kind: "http",
    branch: "dynamics_allens",
    executorStepId: "dynamics_allens",
    config: { method: "PATCH", url: "Dynamics leads({{ lead_id }})" },
    defaultPosition: { x: 2440, y: 200 },
  },
  {
    id: "filter-lead-4",
    n8nRef: 4,
    label: "Filter3 — lead_id",
    kind: "filter",
    branch: "lifecycle_raw",
    executorStepId: "dashboard_raw",
    config: { condition: "{{ $json.body.call.retell_llm_dynamic_variables.lead_id }} exists" },
    defaultPosition: { x: 280, y: 440 },
  },
  {
    id: "if-started-ended",
    n8nRef: 25,
    label: "STARTED OR ENDED",
    kind: "if",
    branch: "lifecycle_raw",
    executorStepId: "dashboard_raw",
    config: { condition: "call_started OR call_ended" },
    defaultPosition: { x: 520, y: 440 },
  },
  {
    id: "post-dashboard-raw",
    n8nRef: 26,
    label: "POST TO DASHBOARD1",
    kind: "http",
    branch: "lifecycle_raw",
    executorStepId: "dashboard_raw",
    config: {
      method: "POST",
      url: "https://uat-api.webespokeai.com/call-output-data/create",
    },
    defaultPosition: { x: 760, y: 440 },
  },
  {
    id: "analyzed-calendly-slot",
    n8nRef: 5,
    label: "Analyzed + Calendly slot",
    kind: "if",
    branch: "dynamics_agentic",
    executorStepId: "dynamics_agentic",
    config: { condition: "{{ $json.body.event }} equals call_analyzed" },
    defaultPosition: { x: 280, y: 560 },
  },
  {
    id: "filter-lead-5",
    n8nRef: 27,
    label: "Filter4 — lead_id",
    kind: "filter",
    branch: "dynamics_agentic",
    executorStepId: "dynamics_agentic",
    config: { condition: "{{ $json.body.call.retell_llm_dynamic_variables.lead_id }} exists" },
    defaultPosition: { x: 520, y: 560 },
  },
  {
    id: "get-structured-json",
    n8nRef: 28,
    label: "getStructuredJson",
    kind: "code",
    branch: "dynamics_agentic",
    executorStepId: "dynamics_agentic",
    config: { codeHint: "Parse structured_json_output" },
    defaultPosition: { x: 760, y: 520 },
  },
  {
    id: "get-all-valid-fields",
    n8nRef: 29,
    label: "getAllValidFields",
    kind: "code",
    branch: "dynamics_agentic",
    executorStepId: "dynamics_agentic",
    defaultPosition: { x: 760, y: 600 },
  },
  {
    id: "merge4",
    n8nRef: 30,
    label: "Merge4",
    kind: "merge",
    branch: "dynamics_agentic",
    executorStepId: "dynamics_agentic",
    defaultPosition: { x: 1000, y: 560 },
  },
  {
    id: "get-all-valid-fields-1",
    n8nRef: 31,
    label: "getALLValidFields1",
    kind: "code",
    branch: "dynamics_agentic",
    executorStepId: "dynamics_agentic",
    config: { codeHint: "normalizeWbahAgenticCrmFields" },
    defaultPosition: { x: 1240, y: 560 },
  },
  {
    id: "merge3",
    n8nRef: 32,
    label: "Merge3",
    kind: "merge",
    branch: "dynamics_agentic",
    executorStepId: "dynamics_agentic",
    defaultPosition: { x: 1480, y: 560 },
  },
  {
    id: "patch-dynamics-agentic",
    n8nRef: 33,
    label: "Agentic POST SUMMARY TO 365",
    kind: "http",
    branch: "dynamics_agentic",
    executorStepId: "dynamics_agentic",
    config: { method: "PATCH", url: "Dynamics leads({{ lead_id }})" },
    defaultPosition: { x: 1720, y: 560 },
  },
  {
    id: "clear-data-agentic",
    n8nRef: 34,
    label: "clearDataforAgentic",
    kind: "code",
    branch: "dynamics_agentic",
    executorStepId: "dynamics_agentic",
    config: { summary: "statecode, status, sentiment, summary only" },
    defaultPosition: { x: 1720, y: 320 },
  },
  {
    id: "webee-live-ingest",
    n8nRef: 6,
    label: "WEBEE Live Ingest",
    kind: "http",
    branch: "webee_live",
    executorStepId: "live_transcript",
    config: {
      method: "POST",
      url: "https://webeebuilder.com/api/public/retell-live-ingest",
    },
    defaultPosition: { x: 280, y: 680 },
  },
  {
    id: "check-appointment-confirmed",
    n8nRef: 35,
    label: "Check Appointment Confirmed",
    kind: "if",
    branch: "calendly_invitee",
    executorStepId: "calendly_invitee",
    config: {
      condition:
        "appointment_confirmed OR (appointment_date + appointment_time valid)",
    },
    defaultPosition: { x: 1480, y: 120 },
  },
  {
    id: "wait-random-delay",
    n8nRef: 36,
    label: "Wait random delay",
    kind: "wait",
    branch: "calendly_invitee",
    executorStepId: "calendly_invitee",
    config: { summary: "5–25 seconds random" },
    defaultPosition: { x: 1720, y: 120 },
  },
  {
    id: "post-calendly-invitees",
    n8nRef: 37,
    label: "POST Calendly invitees",
    kind: "http",
    branch: "calendly_invitee",
    executorStepId: "calendly_invitee",
    config: {
      method: "POST",
      url: "https://api.calendly.com/invitees",
      summary: "Auto-book invitee with Q&A",
    },
    defaultPosition: { x: 1960, y: 120 },
  },
  {
    id: "wbah-calls-upsert",
    label: "WEBEE Calls tab upsert",
    kind: "code",
    branch: "reporting",
    executorStepId: "wbah_calls_upsert",
    config: { summary: "Upsert call row for reporting" },
    defaultPosition: { x: 1960, y: 40 },
  },
];

export const WBAH_N8N_DEFAULT_EDGES: WbahN8nGraphEdge[] = [
  { id: "e-wh-f1", source: "webhook", target: "filter-lead-1" },
  { id: "e-wh-f2", source: "webhook", target: "filter-lead-2" },
  { id: "e-wh-f3", source: "webhook", target: "filter-lead-3" },
  { id: "e-wh-f4", source: "webhook", target: "filter-lead-4" },
  { id: "e-wh-live", source: "webhook", target: "webee-live-ingest" },
  { id: "e-wh-agentic", source: "webhook", target: "analyzed-calendly-slot" },
  { id: "e-f1-7", source: "filter-lead-1", target: "call-analyzed-dashboard" },
  { id: "e-7-fmt", source: "call-analyzed-dashboard", target: "format-data" },
  { id: "e-fmt-link", source: "format-data", target: "create-booking-link" },
  { id: "e-link-slot", source: "create-booking-link", target: "build-slot-url" },
  { id: "e-7-m2", source: "call-analyzed-dashboard", target: "merge2" },
  { id: "e-slot-m2", source: "build-slot-url", target: "merge2" },
  { id: "e-m2-post", source: "merge2", target: "post-dashboard-analyzed" },
  { id: "e-post-calls", source: "post-dashboard-analyzed", target: "wbah-calls-upsert" },
  { id: "e-f2-17", source: "filter-lead-2", target: "call-analyzed-crm" },
  { id: "e-17-token", source: "call-analyzed-crm", target: "get-d365-token" },
  { id: "e-token-mt", source: "get-d365-token", target: "merge-token" },
  { id: "e-mt-m20", source: "merge-token", target: "merge-token-data" },
  { id: "e-f3-21", source: "filter-lead-3", target: "call-analyzed-calendly" },
  { id: "e-21-ex", source: "call-analyzed-calendly", target: "webhook-extract" },
  { id: "e-ex-if", source: "webhook-extract", target: "if-sentiment" },
  { id: "e-if-fwd", source: "if-sentiment", target: "forward-if-block" },
  { id: "e-fwd-m20", source: "forward-if-block", target: "merge-token-data" },
  { id: "e-m20-m1", source: "merge-token-data", target: "merge1" },
  { id: "e-slot-m1", source: "build-slot-url", target: "merge1" },
  { id: "e-m1-status", source: "merge1", target: "get-lead-status" },
  { id: "e-m1-clear", source: "merge1", target: "clear-data-agentic" },
  { id: "e-m1-appt", source: "merge1", target: "check-appointment-confirmed" },
  { id: "e-status-allen", source: "get-lead-status", target: "apply-allens-logic" },
  { id: "e-allen-payload", source: "apply-allens-logic", target: "build-crm-payload" },
  { id: "e-payload-patch", source: "build-crm-payload", target: "patch-dynamics-allen" },
  { id: "e-clear-agentic", source: "clear-data-agentic", target: "patch-dynamics-agentic" },
  { id: "e-appt-wait", source: "check-appointment-confirmed", target: "wait-random-delay" },
  { id: "e-wait-inv", source: "wait-random-delay", target: "post-calendly-invitees" },
  { id: "e-f4-25", source: "filter-lead-4", target: "if-started-ended" },
  { id: "e-25-26", source: "if-started-ended", target: "post-dashboard-raw" },
  { id: "e-5-27", source: "analyzed-calendly-slot", target: "filter-lead-5" },
  { id: "e-27-28", source: "filter-lead-5", target: "get-structured-json" },
  { id: "e-27-29", source: "filter-lead-5", target: "get-all-valid-fields" },
  { id: "e-28-m4", source: "get-structured-json", target: "merge4" },
  { id: "e-29-m4", source: "get-all-valid-fields", target: "merge4" },
  { id: "e-m4-31", source: "merge4", target: "get-all-valid-fields-1" },
  { id: "e-31-m3", source: "get-all-valid-fields-1", target: "merge3" },
  { id: "e-m3-33", source: "merge3", target: "patch-dynamics-agentic" },
];

const CATALOG_BY_ID = Object.fromEntries(WBAH_N8N_NODE_CATALOG.map((n) => [n.id, n]));

export function defaultWbahN8nGraph(): WbahN8nWorkflowGraph {
  return {
    nodes: WBAH_N8N_NODE_CATALOG.map((n) => ({
      id: n.id,
      label: n.label,
      enabled: true,
      config: withDefaultCodeIfMissing(
        n.id,
        n.kind,
        mergeN8nNodeConfig(n.id, n.kind, n.config ?? {}),
      ),
      position: { ...n.defaultPosition },
    })),
    edges: [...WBAH_N8N_DEFAULT_EDGES],
  };
}

/** Blank canvas — webhook trigger only (no pre-loaded n8n production graph). */
export function emptyWbahN8nGraph(): WbahN8nWorkflowGraph {
  const webhook = WBAH_N8N_NODE_CATALOG.find((n) => n.id === "webhook");
  if (!webhook) return { nodes: [], edges: [] };
  return {
    nodes: [
      {
        id: webhook.id,
        label: webhook.label,
        enabled: true,
        config: { ...webhook.config },
        position: { ...webhook.defaultPosition },
      },
    ],
    edges: [],
  };
}

function isBlankN8nGraph(g: WbahN8nWorkflowGraph): boolean {
  if (!g.nodes.length) return true;
  if (g.edges.length > 0) return false;
  const catalogIds = new Set(WBAH_N8N_NODE_CATALOG.map((n) => n.id));
  const catalogNodeCount = g.nodes.filter((n) => catalogIds.has(n.id)).length;
  return catalogNodeCount <= 1;
}

export function isWbahProductionN8nGraph(g: WbahN8nWorkflowGraph | null | undefined): boolean {
  if (!g?.nodes?.length) return false;
  return g.edges.length > 0 && g.nodes.length > 5;
}

export function mergeN8nGraphWithCatalog(stored: WbahN8nWorkflowGraph | null | undefined): WbahN8nWorkflowGraph {
  if (!stored?.nodes?.length) return emptyWbahN8nGraph();

  const enrichNode = (n: WbahN8nNodeInstance): WbahN8nNodeInstance => {
    const cat = CATALOG_BY_ID[n.id];
    if (!cat) return { ...n };
    return {
      id: n.id,
      label: n.label ?? cat.label,
      enabled: n.enabled !== false,
      config: { ...(cat.config ?? {}), ...n.config },
      position: n.position ?? cat.defaultPosition,
    };
  };

  if (isBlankN8nGraph(stored)) {
    return {
      nodes: stored.nodes.map(enrichNode),
      edges: [...(stored.edges ?? [])],
    };
  }

  // Only merge the full production template when the graph is clearly the WBAH template
  // (most catalog ids + many edges). Copilot/draft graphs must never be replaced.
  const catalogIds = new Set(WBAH_N8N_NODE_CATALOG.map((c) => c.id));
  const catalogNodeCount = stored.nodes.filter((n) => catalogIds.has(n.id)).length;
  const isFullProductionTemplate =
    catalogNodeCount >= 25 &&
    stored.nodes.length >= 30 &&
    (stored.edges?.length ?? 0) >= 15;

  if (!isFullProductionTemplate) {
    return {
      nodes: stored.nodes.map(enrichNode),
      edges: [...(stored.edges ?? [])],
    };
  }

  const base = defaultWbahN8nGraph();

  const storedById = Object.fromEntries(stored.nodes.map((n) => [n.id, n]));
  const nodes: WbahN8nNodeInstance[] = [
    ...base.nodes.map((n) => {
      const s = storedById[n.id];
      if (!s) return n;
      return {
        ...n,
        label: s.label ?? n.label,
        enabled: s.enabled !== false,
        config: { ...(n.config ?? {}), ...s.config },
          position: s.position ?? n.position,
      };
    }),
    ...stored.nodes.filter((n) => !CATALOG_BY_ID[n.id]),
  ];
  const finalEdges = stored.edges?.length ? stored.edges : base.edges;
  return { nodes, edges: finalEdges };
}

export function createCustomN8nNode(
  kind: WbahN8nNodeKind,
  position: { x: number; y: number },
): WbahN8nNodeInstance {
  const id = `custom-${kind}-${Date.now().toString(36)}`;
  return {
    id,
    label: `New ${kind}`,
    enabled: true,
    config: { ...defaultN8nParamsForKind(kind) },
    position,
  };
}

export function n8nNodeKindColor(kind: WbahN8nNodeKind): string {
  switch (kind) {
    case "trigger":
      return "sky";
    case "filter":
    case "if":
      return "amber";
    case "merge":
      return "cyan";
    case "code":
      return "violet";
    case "http":
      return "rose";
    case "wait":
      return "orange";
    case "stop":
      return "emerald";
    default:
      return "gray";
  }
}

export function getN8nNodeKind(nodeId: string): WbahN8nNodeKind {
  return CATALOG_BY_ID[nodeId]?.kind ?? (nodeId.startsWith("custom-") ? (nodeId.split("-")[1] as WbahN8nNodeKind) : "code");
}

export function getN8nNodeBranch(nodeId: string): string {
  return CATALOG_BY_ID[nodeId]?.branch ?? "custom";
}
