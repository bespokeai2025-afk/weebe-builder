/**
 * Rebook Initial Consultation post-call — Dynamics Opportunity only (no Lead PATCH, no Calendly).
 */
import type { WbahN8nGraphEdge, WbahN8nNodeDef, WbahN8nWorkflowGraph } from "./wbah-n8n-node-catalog.shared";
import { mergeN8nNodeConfig } from "./wbah-n8n-node-presets.shared";
import { withDefaultCodeIfMissing } from "./wbah-n8n-code-snippets.shared";

export const WBAH_REBOOK_RETELL_AGENTS = [
  "agent_1e1b13bd9564da4556370fe0be",
  "agent_0e07f26bebd25acbd82993e3a3",
] as const;

export const WBAH_REBOOK_N8N_NODE_CATALOG: WbahN8nNodeDef[] = [
  {
    id: "rebook-webhook",
    label: "Webhook",
    kind: "trigger",
    branch: "entry",
    config: { summary: "Retell voice webhook — Rebook agents only" },
    defaultPosition: { x: 40, y: 220 },
  },
  {
    id: "rebook-live-ingest",
    label: "WEBEE live ingest",
    kind: "http",
    branch: "webee_live",
    executorStepId: "live_transcript",
    config: {
      method: "POST",
      url: "/api/public/retell-live-ingest",
      summary: "Live transcript panel",
    },
    defaultPosition: { x: 280, y: 420 },
  },
  {
    id: "rebook-filter-opp",
    label: "Filter — opportunity_id",
    kind: "filter",
    branch: "rebook_dynamics",
    executorStepId: "dynamics_rebook_opportunity",
    config: {
      condition:
        "crm_type=opportunity AND (opportunity_id OR lead_id as opportunityid)",
    },
    defaultPosition: { x: 280, y: 40 },
  },
  {
    id: "rebook-if-analyzed",
    label: "call_analyzed",
    kind: "if",
    branch: "rebook_dynamics",
    executorStepId: "dynamics_rebook_opportunity",
    config: { condition: "{{ $json.body.event }} equals call_analyzed" },
    defaultPosition: { x: 520, y: 40 },
  },
  {
    id: "rebook-format-data",
    label: "Format Rebook Data",
    kind: "code",
    branch: "rebook_dynamics",
    executorStepId: "dynamics_rebook_opportunity",
    config: {
      summary: "Map structured_json_output → Opportunity fields (no Calendly)",
      codeHint: "formatWbahRebookCallData",
    },
    defaultPosition: { x: 760, y: 40 },
  },
  {
    id: "rebook-get-token",
    label: "GET D365 Token",
    kind: "http",
    branch: "rebook_dynamics",
    executorStepId: "dynamics_rebook_opportunity",
    config: { summary: "OAuth2 client_credentials for Dynamics 365" },
    defaultPosition: { x: 1000, y: 40 },
  },
  {
    id: "rebook-merge-token",
    label: "Merge token + payload",
    kind: "code",
    branch: "rebook_dynamics",
    executorStepId: "dynamics_rebook_opportunity",
    config: { codeHint: "mergeRebookTokenPayload" },
    defaultPosition: { x: 1240, y: 40 },
  },
  {
    id: "rebook-patch-opportunity",
    label: "PATCH Opportunity",
    kind: "http",
    branch: "rebook_dynamics",
    executorStepId: "dynamics_rebook_opportunity",
    config: {
      method: "PATCH",
      url: "{{ $json.dynamicsBase }}/opportunities({{ $json.opportunityId }})",
      summary: "Update Rebook Opportunity — never PATCH Lead",
    },
    defaultPosition: { x: 1480, y: 40 },
  },
  {
    id: "rebook-post-note",
    label: "Timeline note (Opportunity)",
    kind: "http",
    branch: "rebook_dynamics",
    executorStepId: "dynamics_rebook_note",
    config: {
      method: "POST",
      url: "{{ $json.dynamicsBase }}/annotations",
      summary: "objectid_opportunity call summary note",
    },
    defaultPosition: { x: 1720, y: 40 },
  },
  {
    id: "rebook-post-dashboard",
    label: "POST TO DASHBOARD",
    kind: "http",
    branch: "rebook_dashboard",
    executorStepId: "dashboard_analyzed",
    config: {
      method: "POST",
      url: "https://uat-api.webespokeai.com/call-output-data/create",
      summary: "Call result to WeeBespoke — no Calendly fields",
    },
    defaultPosition: { x: 1480, y: 180 },
  },
  {
    id: "rebook-calls-upsert",
    label: "WEBEE Calls upsert",
    kind: "code",
    branch: "rebook_dashboard",
    executorStepId: "wbah_calls_upsert",
    config: { codeHint: "upsertWbahCallFromWebhook" },
    defaultPosition: { x: 1720, y: 180 },
  },
  {
    id: "rebook-if-lifecycle",
    label: "call_started / call_ended",
    kind: "if",
    branch: "lifecycle_raw",
    executorStepId: "dashboard_raw",
    config: { condition: "event is call_started OR call_ended" },
    defaultPosition: { x: 520, y: 300 },
  },
  {
    id: "rebook-post-dashboard-raw",
    label: "POST dashboard (raw)",
    kind: "http",
    branch: "lifecycle_raw",
    executorStepId: "dashboard_raw",
    config: {
      method: "POST",
      url: "https://uat-api.webespokeai.com/call-output-data/create",
    },
    defaultPosition: { x: 760, y: 300 },
  },
];

const WBAH_REBOOK_N8N_DEFAULT_EDGES: WbahN8nGraphEdge[] = [
  { id: "rb-wh-live", source: "rebook-webhook", target: "rebook-live-ingest" },
  { id: "rb-wh-f", source: "rebook-webhook", target: "rebook-filter-opp" },
  { id: "rb-wh-lc", source: "rebook-webhook", target: "rebook-if-lifecycle" },
  { id: "rb-f-an", source: "rebook-filter-opp", target: "rebook-if-analyzed" },
  { id: "rb-an-fmt", source: "rebook-if-analyzed", target: "rebook-format-data" },
  { id: "rb-fmt-tok", source: "rebook-format-data", target: "rebook-get-token" },
  { id: "rb-tok-m", source: "rebook-get-token", target: "rebook-merge-token" },
  { id: "rb-m-patch", source: "rebook-merge-token", target: "rebook-patch-opportunity" },
  { id: "rb-patch-note", source: "rebook-patch-opportunity", target: "rebook-post-note" },
  { id: "rb-patch-dash", source: "rebook-patch-opportunity", target: "rebook-post-dashboard" },
  { id: "rb-dash-calls", source: "rebook-post-dashboard", target: "rebook-calls-upsert" },
  { id: "rb-lc-raw", source: "rebook-if-lifecycle", target: "rebook-post-dashboard-raw" },
];

export function defaultWbahRebookN8nGraph(): WbahN8nWorkflowGraph {
  return {
    nodes: WBAH_REBOOK_N8N_NODE_CATALOG.map((n) => ({
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
    edges: [...WBAH_REBOOK_N8N_DEFAULT_EDGES],
  };
}

const REBOOK_CATALOG_BY_ID = Object.fromEntries(
  WBAH_REBOOK_N8N_NODE_CATALOG.map((c) => [c.id, c]),
);

/** Enrich stored Rebook graph nodes from catalog (never merge New Leads template). */
export function mergeRebookN8nGraphWithCatalog(
  stored: WbahN8nWorkflowGraph | null | undefined,
): WbahN8nWorkflowGraph {
  if (!stored?.nodes?.length) return defaultWbahRebookN8nGraph();

  const enrichNode = (n: (typeof stored.nodes)[0]) => {
    const cat = REBOOK_CATALOG_BY_ID[n.id];
    if (!cat) return { ...n };
    return {
      id: n.id,
      label: n.label ?? cat.label,
      enabled: n.enabled !== false,
      config: withDefaultCodeIfMissing(
        n.id,
        cat.kind,
        { ...(cat.config ?? {}), ...n.config },
      ),
      position: n.position ?? cat.defaultPosition,
    };
  };

  const base = defaultWbahRebookN8nGraph();
  const storedById = Object.fromEntries(stored.nodes.map((n) => [n.id, n]));
  const nodes = [
    ...base.nodes.map((n) => {
      const s = storedById[n.id];
      if (!s) return n;
      return enrichNode(s);
    }),
    ...stored.nodes.filter((n) => !REBOOK_CATALOG_BY_ID[n.id]).map(enrichNode),
  ];
  const edges = stored.edges?.length ? stored.edges : base.edges;
  return { nodes, edges };
}
