/**
 * SystemMind Knowledge Graph — SERVER ONLY (spec Phase 8).
 * Loaded dynamically inside createServerFn handlers.
 *
 * Builds a DESCRIPTIVE, per-workspace knowledge graph that connects everything
 * WEBEE knows — builder/agent templates, n8n workflows, SystemMind templates,
 * Retell agents, the WEBEE API Engine, the executive layers (HiveMind /
 * GrowthMind / SystemMind), analytics, integrations/providers, the CRM adapter
 * definitions + universal actions, infrastructure, and deployment history — into
 * connected nodes + edges.
 *
 * DERIVED DATA: the builder does an idempotent FULL rebuild per workspace (delete
 * edges → nodes, then reinsert). Nothing here mutates any source system, executes
 * a CRM operation, or deploys anything.
 *
 * SECURITY:
 *   - Every query is scoped by workspace_id.
 *   - Node metadata is REDACTED: presence booleans / counts only. Credential
 *     values (provider_settings.credentials, encrypted_credentials, tokens…) are
 *     NEVER copied into a node.
 *   - The generated Supabase types are stale (many of these tables aren't in
 *     types.ts), so unknown tables are queried through `as any`, and every source
 *     is wrapped in try/catch so a missing table degrades gracefully.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { listCrmAdapterDefinitions } from "./crm-definitions/registry";
import { listUniversalActions, UNIVERSAL_ACTION_CATEGORIES } from "./universal-actions";
import type {
  NodeType, EdgeType, GraphNode, GraphEdge,
  SourceResult, GraphSummary, GraphView, DependencyView,
} from "./knowledge-graph.schema";

const CAP = 500; // max rows ingested per source table

// ── Staging types ─────────────────────────────────────────────────────────────
interface StagedNode {
  node_key: string;
  node_type: NodeType;
  source_table?: string | null;
  source_id?: string | null;
  label: string;
  summary?: string | null;
  status?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

interface StagedEdge {
  from_key: string;
  to_key: string;
  edge_type: EdgeType;
  metadata?: Record<string, unknown>;
}

interface Staged {
  nodes: StagedNode[];
  edges: StagedEdge[];
}

const empty = (): Staged => ({ nodes: [], edges: [] });

// Untyped client — generated types don't cover most SystemMind tables.
const sb = supabaseAdmin as any;

async function runSource(
  source: string,
  fn: () => Promise<Staged>,
  results: SourceResult[],
): Promise<Staged> {
  try {
    const staged = await fn();
    results.push({ source, count: staged.nodes.length });
    return staged;
  } catch (e: any) {
    results.push({ source, count: 0, error: String(e?.message ?? e) });
    return empty();
  }
}

async function safeCount(table: string, workspaceId: string): Promise<number> {
  try {
    const { count } = await sb
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);
    return count ?? 0;
  } catch {
    return 0;
  }
}

// ── Source ingestors ──────────────────────────────────────────────────────────

function workspaceKey(id: string) {
  return `workspace:${id}`;
}

async function ingestWorkspace(workspaceId: string): Promise<Staged> {
  const { data } = await sb.from("workspaces").select("id, name").eq("id", workspaceId).maybeSingle();
  const label = data?.name ?? "Workspace";
  return {
    nodes: [
      {
        node_key: workspaceKey(workspaceId),
        node_type: "workspace",
        source_table: "workspaces",
        source_id: workspaceId,
        label,
        summary: "Tenant root — everything below belongs to this workspace.",
        status: "active",
        metadata: {},
      },
    ],
    edges: [],
  };
}

async function ingestAgents(workspaceId: string): Promise<Staged> {
  const { data } = await sb
    .from("agents")
    .select("id, retell_agent_id, name, settings, inbound_phone_number, updated_at")
    .eq("workspace_id", workspaceId)
    .limit(CAP);
  const rows: any[] = data ?? [];
  const nodes: StagedNode[] = [];
  const edges: StagedEdge[] = [];
  for (const r of rows) {
    const key = `agents:${r.id}`;
    const voiceProvider = r.settings?.voice_provider ?? null; // not a secret
    nodes.push({
      node_key: key,
      node_type: "agent",
      source_table: "agents",
      source_id: String(r.id),
      label: r.name ?? "Untitled agent",
      status: r.retell_agent_id ? "deployed" : "draft",
      metadata: {
        has_retell_agent: !!r.retell_agent_id,
        has_inbound_number: !!r.inbound_phone_number,
        voice_provider: voiceProvider,
      },
    });
    edges.push({ from_key: key, to_key: workspaceKey(workspaceId), edge_type: "belongs_to" });
    if (voiceProvider) {
      edges.push({ from_key: key, to_key: `integration:voice:${voiceProvider}`, edge_type: "uses_provider" });
    }
  }
  return { nodes, edges };
}

async function ingestAgentTemplates(workspaceId: string): Promise<Staged> {
  const { data } = await sb
    .from("agent_templates")
    .select("id, scope, name, description, agent_type")
    .or(`scope.eq.public,workspace_id.eq.${workspaceId}`)
    .limit(CAP);
  const rows: any[] = data ?? [];
  const nodes: StagedNode[] = [];
  const edges: StagedEdge[] = [];
  for (const r of rows) {
    const key = `agent_templates:${r.id}`;
    nodes.push({
      node_key: key,
      node_type: "agent_template",
      source_table: "agent_templates",
      source_id: String(r.id),
      label: r.name ?? "Untitled template",
      summary: r.description ?? null,
      status: r.scope ?? null,
      metadata: { scope: r.scope ?? null, agent_type: r.agent_type ?? null },
    });
    edges.push({ from_key: key, to_key: workspaceKey(workspaceId), edge_type: "belongs_to" });
  }
  return { nodes, edges };
}

async function ingestN8nWorkflows(workspaceId: string): Promise<Staged> {
  const { data } = await sb
    .from("systemmind_n8n_workflows")
    .select("*")
    .eq("workspace_id", workspaceId)
    .limit(CAP);
  const rows: any[] = data ?? [];
  const nodes: StagedNode[] = [];
  const edges: StagedEdge[] = [];
  for (const r of rows) {
    const key = `systemmind_n8n_workflows:${r.id}`;
    const nodeCount = Array.isArray(r.nodes) ? r.nodes.length : (r.node_count ?? null);
    nodes.push({
      node_key: key,
      node_type: "n8n_workflow",
      source_table: "systemmind_n8n_workflows",
      source_id: String(r.id),
      label: r.name ?? "Untitled workflow",
      status: r.active === true ? "active" : r.active === false ? "inactive" : (r.status ?? null),
      tags: r.workflow_category ? [r.workflow_category] : [],
      metadata: {
        node_count: nodeCount,
        template_type: r.template_type ?? null,
        workflow_category: r.workflow_category ?? null,
      },
    });
    edges.push({ from_key: key, to_key: workspaceKey(workspaceId), edge_type: "belongs_to" });
  }
  return { nodes, edges };
}

async function ingestWorkflowTemplates(workspaceId: string): Promise<Staged> {
  const { data } = await sb
    .from("systemmind_workflow_templates")
    .select("id, name, category, template_type, status, is_trusted, confidence, linked_n8n_workflow_ids")
    .eq("workspace_id", workspaceId)
    .limit(CAP);
  const rows: any[] = data ?? [];
  const nodes: StagedNode[] = [];
  const edges: StagedEdge[] = [];
  for (const r of rows) {
    const key = `systemmind_workflow_templates:${r.id}`;
    nodes.push({
      node_key: key,
      node_type: "workflow_template",
      source_table: "systemmind_workflow_templates",
      source_id: String(r.id),
      label: r.name ?? "Untitled template",
      status: r.status ?? null,
      tags: r.category ? [r.category] : [],
      metadata: {
        category: r.category ?? null,
        template_type: r.template_type ?? null,
        is_trusted: !!r.is_trusted,
        confidence: r.confidence ?? null,
      },
    });
    edges.push({ from_key: key, to_key: workspaceKey(workspaceId), edge_type: "belongs_to" });
    for (const wfId of (r.linked_n8n_workflow_ids ?? [])) {
      edges.push({
        from_key: key,
        to_key: `systemmind_n8n_workflows:${wfId}`,
        edge_type: "derived_from",
      });
    }
  }
  return { nodes, edges };
}

async function ingestApiConnections(workspaceId: string): Promise<Staged> {
  const { data } = await sb
    .from("client_api_connections")
    .select("id, name, base_url, auth_type, status")
    .eq("workspace_id", workspaceId)
    .limit(CAP);
  const rows: any[] = data ?? [];
  const nodes: StagedNode[] = [];
  const edges: StagedEdge[] = [];
  for (const r of rows) {
    const key = `client_api_connections:${r.id}`;
    let host: string | null = null;
    try {
      host = r.base_url ? new URL(r.base_url).host : null;
    } catch {
      host = null;
    }
    nodes.push({
      node_key: key,
      node_type: "api_connection",
      source_table: "client_api_connections",
      source_id: String(r.id),
      label: r.name ?? "API connection",
      status: r.status ?? null,
      metadata: { auth_type: r.auth_type ?? null, host }, // host only, never credentials
    });
    edges.push({ from_key: key, to_key: workspaceKey(workspaceId), edge_type: "belongs_to" });
  }
  return { nodes, edges };
}

async function ingestApiEndpoints(workspaceId: string): Promise<Staged> {
  const { data } = await sb
    .from("client_api_endpoint_mappings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .limit(CAP);
  const rows: any[] = data ?? [];
  const nodes: StagedNode[] = [];
  const edges: StagedEdge[] = [];
  for (const r of rows) {
    const key = `client_api_endpoint_mappings:${r.id}`;
    const method = r.method ?? r.http_method ?? null;
    const path = r.path ?? r.endpoint ?? r.url_template ?? "";
    const connId = r.connection_id ?? r.client_api_connection_id ?? null;
    nodes.push({
      node_key: key,
      node_type: "api_endpoint",
      source_table: "client_api_endpoint_mappings",
      source_id: String(r.id),
      label: r.name ?? [method, path].filter(Boolean).join(" ") ?? "Endpoint",
      metadata: { method, has_path: !!path },
    });
    if (connId) {
      edges.push({
        from_key: `client_api_connections:${connId}`,
        to_key: key,
        edge_type: "integrates_with",
      });
    }
  }
  return { nodes, edges };
}

async function ingestExecutives(workspaceId: string): Promise<Staged> {
  const nodes: StagedNode[] = [];
  const edges: StagedEdge[] = [];

  // HiveMind (COO)
  const [tasks, actions, briefings] = await Promise.all([
    safeCount("hivemind_tasks", workspaceId),
    safeCount("hivemind_actions", workspaceId),
    safeCount("hivemind_briefings", workspaceId),
  ]);
  const hmKey = `hivemind:${workspaceId}`;
  nodes.push({
    node_key: hmKey,
    node_type: "hivemind",
    label: "HiveMind (COO)",
    summary: "Operational executive layer — tasks, actions, briefings.",
    metadata: { tasks, actions, briefings },
  });
  edges.push({ from_key: hmKey, to_key: workspaceKey(workspaceId), edge_type: "belongs_to" });

  // GrowthMind (CMO)
  const campaigns = await safeCount("growthmind_ad_campaigns", workspaceId);
  const gmKey = `growthmind:${workspaceId}`;
  nodes.push({
    node_key: gmKey,
    node_type: "growthmind",
    label: "GrowthMind (CMO)",
    summary: "Marketing executive layer — campaigns and content.",
    metadata: { campaigns },
  });
  edges.push({ from_key: gmKey, to_key: workspaceKey(workspaceId), edge_type: "belongs_to" });

  // SystemMind (CTO) — self
  const [templates, workflows] = await Promise.all([
    safeCount("systemmind_workflow_templates", workspaceId),
    safeCount("systemmind_n8n_workflows", workspaceId),
  ]);
  const smKey = `systemmind:${workspaceId}`;
  nodes.push({
    node_key: smKey,
    node_type: "systemmind",
    label: "SystemMind (CTO)",
    summary: "Technical executive layer — workflow templates and discovery.",
    metadata: { templates, workflows },
  });
  edges.push({ from_key: smKey, to_key: workspaceKey(workspaceId), edge_type: "belongs_to" });

  return { nodes, edges };
}

async function ingestAnalytics(workspaceId: string): Promise<Staged> {
  // NEVER create per-call nodes — aggregate into ONE analytics node.
  const calls = await safeCount("calls", workspaceId);
  const key = `analytics:${workspaceId}`;
  return {
    nodes: [
      {
        node_key: key,
        node_type: "analytics",
        label: "Analytics",
        summary: "Aggregated call + campaign performance for this workspace.",
        metadata: { calls },
      },
    ],
    edges: [{ from_key: key, to_key: workspaceKey(workspaceId), edge_type: "belongs_to" }],
  };
}

async function ingestIntegrations(workspaceId: string): Promise<Staged> {
  const { data } = await sb
    .from("provider_settings")
    .select("provider_category, provider_name, status")
    .eq("workspace_id", workspaceId)
    .limit(CAP);
  const rows: any[] = data ?? [];
  const nodes: StagedNode[] = [];
  const edges: StagedEdge[] = [];
  for (const r of rows) {
    const category = r.provider_category ?? "other";
    const name = r.provider_name ?? "provider";
    const key = `integration:${category}:${name}`;
    nodes.push({
      node_key: key,
      node_type: "integration",
      source_table: "provider_settings",
      source_id: `${category}:${name}`,
      label: `${name} (${category})`,
      status: r.status ?? null,
      tags: [category],
      // presence / status only — NEVER credentials
      metadata: { category, name, connected: r.status === "connected" },
    });
    edges.push({ from_key: key, to_key: workspaceKey(workspaceId), edge_type: "belongs_to" });
  }
  return { nodes, edges };
}

async function ingestDeployments(workspaceId: string): Promise<Staged> {
  const { data } = await sb
    .from("deployments")
    .select("id, provider, provider_agent_id, agent_id, deployed_at")
    .eq("workspace_id", workspaceId)
    .limit(CAP);
  const rows: any[] = data ?? [];
  const nodes: StagedNode[] = [];
  const edges: StagedEdge[] = [];
  for (const r of rows) {
    const key = `deployments:${r.id}`;
    nodes.push({
      node_key: key,
      node_type: "deployment",
      source_table: "deployments",
      source_id: String(r.id),
      label: `${r.provider ?? "provider"} deployment`,
      status: r.provider_agent_id ? "live" : null,
      metadata: {
        provider: r.provider ?? null,
        has_provider_agent_id: !!r.provider_agent_id,
        deployed_at: r.deployed_at ?? null,
      },
    });
    if (r.agent_id) {
      edges.push({ from_key: `agents:${r.agent_id}`, to_key: key, edge_type: "deployed_as" });
    }
  }
  return { nodes, edges };
}

function ingestCrmAdapters(workspaceId: string): Staged {
  const nodes: StagedNode[] = [];
  const edges: StagedEdge[] = [];
  for (const def of listCrmAdapterDefinitions()) {
    const key = `static:crm:${def.name}`;
    const supported = def.actionMappings.filter((a) => a.supported);
    nodes.push({
      node_key: key,
      node_type: "crm_adapter",
      source_table: null,
      source_id: def.name,
      label: def.label,
      summary: def.description,
      status: def.status,
      tags: [def.auth.type],
      metadata: {
        vendor: def.vendor,
        auth_type: def.auth.type,
        capabilities: def.capabilities,
        supported_actions: supported.length,
        total_actions: def.actionMappings.length,
      },
    });
    // Anchor CRM adapters to the workspace graph.
    edges.push({ from_key: workspaceKey(workspaceId), to_key: key, edge_type: "supported_by" });
    for (const m of supported) {
      edges.push({
        from_key: key,
        to_key: `static:action:${m.action}`,
        edge_type: "maps_to_action",
        metadata: m.endpoint ? { endpoint: m.endpoint, method: m.method ?? null } : {},
      });
    }
  }
  return { nodes, edges };
}

function ingestUniversalActions(): Staged {
  const nodes: StagedNode[] = listUniversalActions().map((a) => ({
    node_key: `static:action:${a.id}`,
    node_type: "universal_action" as NodeType,
    source_table: null,
    source_id: a.id,
    label: a.label,
    summary: a.intent,
    tags: [UNIVERSAL_ACTION_CATEGORIES[a.category] ?? a.category],
    metadata: { category: a.category, idempotent: a.idempotent },
  }));
  return { nodes, edges: [] };
}

function ingestInfrastructure(workspaceId: string): Staged {
  const supabaseKey = "static:infra:supabase";
  const redisKey = "static:infra:redis";
  return {
    nodes: [
      {
        node_key: supabaseKey,
        node_type: "infrastructure",
        label: "Supabase (Postgres + Auth)",
        summary: "Primary datastore, auth, and RLS boundary.",
        metadata: { role: "database" },
      },
      {
        node_key: redisKey,
        node_type: "infrastructure",
        label: "Redis (cache)",
        summary: "Caching layer for hot reads.",
        metadata: { role: "cache" },
      },
    ],
    edges: [
      { from_key: workspaceKey(workspaceId), to_key: supabaseKey, edge_type: "depends_on" },
      { from_key: workspaceKey(workspaceId), to_key: redisKey, edge_type: "depends_on" },
    ],
  };
}

// ── Builder ───────────────────────────────────────────────────────────────────

export interface BuildResult {
  buildId: string | null;
  nodeCount: number;
  edgeCount: number;
  sourceResults: SourceResult[];
}

/**
 * Idempotent FULL rebuild of the knowledge graph for one workspace.
 * Deletes existing edges → nodes for the workspace, then reinserts.
 */
export async function buildKnowledgeGraph(
  workspaceId: string,
  builtBy?: string | null,
): Promise<BuildResult> {
  const startedAt = new Date().toISOString();
  const results: SourceResult[] = [];

  // 1) Gather from every source (each resilient to a missing table).
  const staged: Staged[] = [];
  staged.push(await runSource("workspace", () => ingestWorkspace(workspaceId), results));
  staged.push(await runSource("agents", () => ingestAgents(workspaceId), results));
  staged.push(await runSource("agent_templates", () => ingestAgentTemplates(workspaceId), results));
  staged.push(await runSource("n8n_workflows", () => ingestN8nWorkflows(workspaceId), results));
  staged.push(await runSource("workflow_templates", () => ingestWorkflowTemplates(workspaceId), results));
  staged.push(await runSource("api_connections", () => ingestApiConnections(workspaceId), results));
  staged.push(await runSource("api_endpoints", () => ingestApiEndpoints(workspaceId), results));
  staged.push(await runSource("executives", () => ingestExecutives(workspaceId), results));
  staged.push(await runSource("analytics", () => ingestAnalytics(workspaceId), results));
  staged.push(await runSource("integrations", () => ingestIntegrations(workspaceId), results));
  staged.push(await runSource("deployments", () => ingestDeployments(workspaceId), results));
  staged.push(await runSource("crm_adapters", async () => ingestCrmAdapters(workspaceId), results));
  staged.push(await runSource("universal_actions", async () => ingestUniversalActions(), results));
  staged.push(await runSource("infrastructure", async () => ingestInfrastructure(workspaceId), results));

  // 2) Dedupe nodes by node_key; collect edges.
  const nodeByKey = new Map<string, StagedNode>();
  const edges: StagedEdge[] = [];
  for (const s of staged) {
    for (const n of s.nodes) if (!nodeByKey.has(n.node_key)) nodeByKey.set(n.node_key, n);
    for (const e of s.edges) edges.push(e);
  }

  // 3) Reset this workspace's graph (edges first — FK to nodes).
  await sb.from("systemmind_graph_edges").delete().eq("workspace_id", workspaceId);
  await sb.from("systemmind_graph_nodes").delete().eq("workspace_id", workspaceId);

  // 4) Insert nodes in batches, capturing generated ids per node_key.
  const keyToId = new Map<string, string>();
  const nodeRows = Array.from(nodeByKey.values()).map((n) => ({
    workspace_id: workspaceId,
    node_type: n.node_type,
    source_table: n.source_table ?? null,
    source_id: n.source_id ?? null,
    node_key: n.node_key,
    label: n.label,
    summary: n.summary ?? null,
    status: n.status ?? null,
    tags: n.tags ?? [],
    metadata: n.metadata ?? {},
  }));

  for (let i = 0; i < nodeRows.length; i += 200) {
    const batch = nodeRows.slice(i, i + 200);
    const { data: inserted, error } = await sb
      .from("systemmind_graph_nodes")
      .insert(batch)
      .select("id, node_key");
    if (error) throw new Error(`node insert failed: ${error.message}`);
    for (const row of inserted ?? []) keyToId.set(row.node_key, row.id);
  }

  // 5) Resolve + dedupe edges, then insert.
  const seenEdge = new Set<string>();
  const edgeRows: any[] = [];
  for (const e of edges) {
    const from = keyToId.get(e.from_key);
    const to = keyToId.get(e.to_key);
    if (!from || !to || from === to) continue;
    const sig = `${from}|${to}|${e.edge_type}`;
    if (seenEdge.has(sig)) continue;
    seenEdge.add(sig);
    edgeRows.push({
      workspace_id: workspaceId,
      from_node_id: from,
      to_node_id: to,
      edge_type: e.edge_type,
      metadata: e.metadata ?? {},
    });
  }
  for (let i = 0; i < edgeRows.length; i += 200) {
    const batch = edgeRows.slice(i, i + 200);
    const { error } = await sb.from("systemmind_graph_edges").insert(batch);
    if (error) throw new Error(`edge insert failed: ${error.message}`);
  }

  // 6) Record the build.
  let buildId: string | null = null;
  try {
    const { data: build } = await sb
      .from("systemmind_graph_builds")
      .insert({
        workspace_id: workspaceId,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        node_count: nodeRows.length,
        edge_count: edgeRows.length,
        source_results: results,
        errors: results.filter((r) => r.error),
        built_by: builtBy ?? null,
      })
      .select("id")
      .maybeSingle();
    buildId = build?.id ?? null;
  } catch {
    buildId = null;
  }

  return { buildId, nodeCount: nodeRows.length, edgeCount: edgeRows.length, sourceResults: results };
}

// ── Readers ─────────────────────────────────────────────────────────────────

export async function getKnowledgeGraphSummary(workspaceId: string): Promise<GraphSummary> {
  const [buildRes, nodesRes, edgesRes] = await Promise.all([
    sb.from("systemmind_graph_builds").select("*").eq("workspace_id", workspaceId).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("systemmind_graph_nodes").select("node_type").eq("workspace_id", workspaceId).limit(5000),
    sb.from("systemmind_graph_edges").select("edge_type").eq("workspace_id", workspaceId).limit(10000),
  ]);

  const nodeCounts: Record<string, number> = {};
  for (const n of (nodesRes.data ?? [])) nodeCounts[n.node_type] = (nodeCounts[n.node_type] ?? 0) + 1;
  const edgeCounts: Record<string, number> = {};
  for (const e of (edgesRes.data ?? [])) edgeCounts[e.edge_type] = (edgeCounts[e.edge_type] ?? 0) + 1;

  const b = buildRes.data;
  return {
    lastBuild: b
      ? {
          id: b.id,
          started_at: b.started_at,
          finished_at: b.finished_at,
          node_count: b.node_count,
          edge_count: b.edge_count,
          source_results: b.source_results ?? [],
          errors: b.errors ?? [],
        }
      : null,
    nodeCounts,
    edgeCounts,
    totalNodes: (nodesRes.data ?? []).length,
    totalEdges: (edgesRes.data ?? []).length,
  };
}

export interface ListNodesArgs {
  nodeType?: string;
  search?: string;
  limit?: number;
}

export async function listKnowledgeGraphNodes(
  workspaceId: string,
  args: ListNodesArgs = {},
): Promise<GraphNode[]> {
  let q = sb
    .from("systemmind_graph_nodes")
    .select("id, node_type, source_table, source_id, node_key, label, summary, status, tags, metadata")
    .eq("workspace_id", workspaceId);
  if (args.nodeType) q = q.eq("node_type", args.nodeType);
  if (args.search) q = q.ilike("label", `%${args.search}%`);
  q = q.order("node_type", { ascending: true }).limit(Math.min(args.limit ?? 500, 1000));
  const { data } = await q;
  return (data ?? []) as GraphNode[];
}

/** Full (capped) graph for the overview map. */
export async function getKnowledgeGraphView(workspaceId: string, limit = 400): Promise<GraphView> {
  const [nodesRes, edgesRes] = await Promise.all([
    sb.from("systemmind_graph_nodes").select("id, node_type, source_table, source_id, node_key, label, summary, status, tags, metadata").eq("workspace_id", workspaceId).limit(limit),
    sb.from("systemmind_graph_edges").select("id, from_node_id, to_node_id, edge_type, metadata").eq("workspace_id", workspaceId).limit(limit * 6),
  ]);
  const nodes = (nodesRes.data ?? []) as GraphNode[];
  const ids = new Set(nodes.map((n) => n.id));
  const edges = ((edgesRes.data ?? []) as GraphEdge[]).filter((e) => ids.has(e.from_node_id) && ids.has(e.to_node_id));
  return { nodes, edges };
}

/**
 * Depth-limited BFS around a node (both directions) — powers the dependency
 * viewer for a workflow/template/agent.
 */
export async function getNodeDependencies(
  workspaceId: string,
  nodeId: string,
  depth = 2,
): Promise<DependencyView> {
  const cappedDepth = Math.max(1, Math.min(depth, 4));
  const [nodesRes, edgesRes] = await Promise.all([
    sb.from("systemmind_graph_nodes").select("id, node_type, source_table, source_id, node_key, label, summary, status, tags, metadata").eq("workspace_id", workspaceId).limit(5000),
    sb.from("systemmind_graph_edges").select("id, from_node_id, to_node_id, edge_type, metadata").eq("workspace_id", workspaceId).limit(20000),
  ]);
  const allNodes = (nodesRes.data ?? []) as GraphNode[];
  const allEdges = (edgesRes.data ?? []) as GraphEdge[];
  const nodeById = new Map(allNodes.map((n) => [n.id, n]));

  const adj = new Map<string, GraphEdge[]>();
  for (const e of allEdges) {
    (adj.get(e.from_node_id) ?? adj.set(e.from_node_id, []).get(e.from_node_id)!).push(e);
    (adj.get(e.to_node_id) ?? adj.set(e.to_node_id, []).get(e.to_node_id)!).push(e);
  }

  const root = nodeById.get(nodeId) ?? null;
  if (!root) return { root: null, nodes: [], edges: [], depth: cappedDepth };

  const visited = new Set<string>([nodeId]);
  const keptEdges = new Map<string, GraphEdge>();
  let frontier = [nodeId];
  for (let d = 0; d < cappedDepth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of (adj.get(id) ?? [])) {
        keptEdges.set(e.id, e);
        const other = e.from_node_id === id ? e.to_node_id : e.from_node_id;
        if (!visited.has(other)) {
          visited.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  const nodes = Array.from(visited).map((id) => nodeById.get(id)).filter(Boolean) as GraphNode[];
  const edges = Array.from(keptEdges.values()).filter((e) => visited.has(e.from_node_id) && visited.has(e.to_node_id));
  return { root, nodes, edges, depth: cappedDepth };
}
