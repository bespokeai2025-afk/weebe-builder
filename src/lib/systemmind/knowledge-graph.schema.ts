// ── Knowledge Graph schema (spec Phase 8) — PURE, shared by client + server ────
// Node/edge type vocabularies plus UI metadata. No server imports so the
// explorer page can render legends/filters from the same source of truth the
// builder writes against. Descriptive only.

export const NODE_TYPES = [
  "workspace",
  "agent",
  "agent_template",
  "n8n_workflow",
  "workflow_template",
  "api_connection",
  "api_endpoint",
  "hivemind",
  "growthmind",
  "systemmind",
  "analytics",
  "integration",
  "crm_adapter",
  "universal_action",
  "deployment",
  "infrastructure",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_TYPES = [
  "belongs_to",
  "uses_provider",
  "maps_to_action",
  "derived_from",
  "deployed_as",
  "depends_on",
  "integrates_with",
  "supported_by",
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

export interface NodeTypeMeta {
  label: string;
  /** Hex colour for graph dots / legend. */
  color: string;
  /** lucide-react icon name. */
  icon: string;
  group: string;
}

export const NODE_TYPE_META: Record<NodeType, NodeTypeMeta> = {
  workspace:         { label: "Workspace",        color: "#38bdf8", icon: "Building2",   group: "Tenant" },
  agent:             { label: "Agent",            color: "#22d3ee", icon: "Bot",         group: "Voice" },
  agent_template:    { label: "Agent Template",   color: "#2dd4bf", icon: "Copy",        group: "Voice" },
  n8n_workflow:      { label: "n8n Workflow",     color: "#a78bfa", icon: "GitBranch",   group: "Automation" },
  workflow_template: { label: "Workflow Template",color: "#c084fc", icon: "Boxes",       group: "Automation" },
  api_connection:    { label: "API Connection",   color: "#f59e0b", icon: "Cable",       group: "Integrations" },
  api_endpoint:      { label: "API Endpoint",     color: "#fbbf24", icon: "Waypoints",   group: "Integrations" },
  hivemind:          { label: "HiveMind (COO)",   color: "#f472b6", icon: "Brain",       group: "Executives" },
  growthmind:        { label: "GrowthMind (CMO)", color: "#fb7185", icon: "TrendingUp",  group: "Executives" },
  systemmind:        { label: "SystemMind (CTO)", color: "#60a5fa", icon: "Server",      group: "Executives" },
  analytics:         { label: "Analytics",        color: "#34d399", icon: "BarChart3",   group: "Insights" },
  integration:       { label: "Integration",      color: "#fb923c", icon: "PlugZap",     group: "Integrations" },
  crm_adapter:       { label: "CRM Adapter",      color: "#818cf8", icon: "Share2",      group: "CRM" },
  universal_action:  { label: "Universal Action", color: "#a3e635", icon: "Zap",         group: "CRM" },
  deployment:        { label: "Deployment",       color: "#4ade80", icon: "Rocket",      group: "Ops" },
  infrastructure:    { label: "Infrastructure",   color: "#94a3b8", icon: "Database",    group: "Ops" },
};

export const EDGE_TYPE_META: Record<EdgeType, { label: string }> = {
  belongs_to:      { label: "belongs to" },
  uses_provider:   { label: "uses provider" },
  maps_to_action:  { label: "maps to action" },
  derived_from:    { label: "derived from" },
  deployed_as:     { label: "deployed as" },
  depends_on:      { label: "depends on" },
  integrates_with: { label: "integrates with" },
  supported_by:    { label: "supported by" },
};

export interface GraphNode {
  id: string;
  node_type: NodeType | string;
  source_table: string | null;
  source_id: string | null;
  node_key: string;
  label: string;
  summary: string | null;
  status: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: EdgeType | string;
  metadata: Record<string, unknown>;
}

// ── Reader output shapes (shared client + server) ─────────────────────────────

export interface SourceResult {
  source: string;
  count: number;
  error?: string;
}

export interface GraphSummary {
  lastBuild: {
    id: string;
    started_at: string;
    finished_at: string | null;
    node_count: number;
    edge_count: number;
    source_results: SourceResult[];
    errors: SourceResult[];
  } | null;
  nodeCounts: Record<string, number>;
  edgeCounts: Record<string, number>;
  totalNodes: number;
  totalEdges: number;
}

export interface GraphView {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface DependencyView {
  root: GraphNode | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  depth: number;
}
