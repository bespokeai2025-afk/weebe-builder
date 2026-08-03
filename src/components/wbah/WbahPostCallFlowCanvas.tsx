/**
 * n8n-style React Flow canvas — fullscreen editor, inspector, auto-layout.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Braces,
  Clock,
  Filter,
  GitMerge,
  Globe,
  LayoutGrid,
  Minimize2,
  RotateCcw,
  Save,
  Search,
  Split,
  Square,
  Trash2,
  Webhook,
  X,
  ZoomIn,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  autoLayoutN8nGraph,
  resetN8nGraphLayout,
} from "@/lib/wbah/workflow/wbah-n8n-graph-layout.shared";
import {
  WBAH_N8N_BRANCH_LABELS,
} from "@/lib/wbah/workflow/wbah-n8n-node-implementations.shared";
import {
  WBAH_N8N_NODE_CATALOG,
  n8nNodeKindColor,
  type WbahN8nNodeKind,
} from "@/lib/wbah/workflow/wbah-n8n-node-catalog.shared";
import type { WbahPostCallWorkflowConfig } from "@/lib/wbah/workflow/wbah-workflow-steps.shared";
import {
  n8nGraphToReactFlow,
  reactFlowToN8nGraph,
  removeEdgeFromN8nGraph,
  removeN8nNodeFromGraph,
  updateN8nNodeInGraph,
  type WbahFlowGraphMeta,
} from "@/lib/wbah/workflow/wbah-workflow-graph.shared";
import {
  branchHandleClass,
  getNodeOutputLayout,
} from "@/lib/wbah/workflow/wbah-n8n-node-branches.shared";
import { N8nNodeEditorLayout } from "@/components/wbah/N8nNodeEditorLayout";
import { N8nNodeEditorModal } from "@/components/wbah/N8nNodeEditorModal";
import type { WbahN8nNodeConfig } from "@/lib/wbah/workflow/wbah-n8n-node-presets.shared";
import type { LucideIcon } from "lucide-react";

const WBAH_FLOW_CONTROL_STYLES = `
  .wbah-n8n-flow .react-flow__controls {
    box-shadow: 0 4px 14px rgba(0,0,0,0.45);
  }
  .wbah-n8n-flow .react-flow__controls-button {
    background: #1f2937 !important;
    border-color: #4b5563 !important;
    color: #e5e7eb !important;
    fill: #e5e7eb !important;
  }
  .wbah-n8n-flow .react-flow__controls-button:hover {
    background: #374151 !important;
  }
  .wbah-n8n-flow .react-flow__controls-button svg {
    fill: #e5e7eb !important;
    max-width: 14px;
    max-height: 14px;
  }
  .wbah-n8n-flow .react-flow__controls-button path {
    fill: #e5e7eb !important;
  }
`;
const KIND_ICON: Record<WbahN8nNodeKind, LucideIcon> = {
  trigger: Webhook,
  http: Globe,
  code: Braces,
  merge: GitMerge,
  if: Split,
  filter: Filter,
  wait: Clock,
  stop: Square,
};

const KIND_ICON_BG: Record<string, string> = {
  sky: "bg-sky-500/20 text-sky-300",
  amber: "bg-amber-500/20 text-amber-300",
  cyan: "bg-cyan-500/20 text-cyan-300",
  violet: "bg-violet-500/20 text-violet-300",
  rose: "bg-rose-500/20 text-rose-300",
  orange: "bg-orange-500/20 text-orange-300",
  emerald: "bg-emerald-500/20 text-emerald-300",
  gray: "bg-gray-500/20 text-gray-300",
};

function N8nCompactNodeBody({
  kind,
  label,
  selected,
  enabled,
  dimmed,
}: {
  kind: WbahN8nNodeKind;
  label: string;
  selected?: boolean;
  enabled?: boolean;
  dimmed?: boolean;
}) {
  const color = n8nNodeKindColor(kind);
  const Icon = KIND_ICON[kind] ?? Braces;
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-gray-700/80 bg-[#181822] px-3 py-3 w-[108px] min-h-[96px] shadow-md transition-all",
        selected && "ring-2 ring-violet-400/60 border-violet-500/40",
        !enabled && "opacity-40 grayscale",
        dimmed && "opacity-25",
      )}
    >
      <div
        className={cn(
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-lg",
          KIND_ICON_BG[color] ?? KIND_ICON_BG.gray,
        )}
      >
        <Icon className="h-7 w-7" strokeWidth={1.75} />
      </div>
      <p className="text-[10px] font-medium text-gray-100 text-center leading-snug line-clamp-3 w-full break-words">
        {label || "Unnamed"}
      </p>
    </div>
  );
}

function TriggerNode({ data, selected }: NodeProps) {
  const label = String(data.label ?? "Webhook");
  return (
    <div className="relative cursor-pointer">
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-sky-400 !w-2.5 !h-2.5 !border-2 !border-[#181822]"
      />
      <N8nCompactNodeBody kind="trigger" label={label} selected={selected} enabled={data.enabled !== false} dimmed={!!data.dimmed} />
    </div>
  );
}

function N8nNode({ data, selected }: NodeProps) {
  const kind = String(data.kind ?? "code") as WbahN8nNodeKind;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const outputLayout = getNodeOutputLayout(kind, config);
  const label = String(data.label ?? kind);

  return (
    <div className="relative cursor-pointer">
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-gray-400 !w-2.5 !h-2.5 !border-2 !border-[#181822]"
      />
      {outputLayout.branches.length > 1 ? (
        outputLayout.branches.map((branch) => (
          <Handle
            key={branch.id}
            id={branch.id}
            type="source"
            position={Position.Right}
            style={{ top: `${branch.topPct}%` }}
            className={cn("!w-2.5 !h-2.5 !border-2 !border-[#181822]", branchHandleClass(branch.color))}
          />
        ))
      ) : (
        <Handle
          id={outputLayout.branches[0]?.id ?? "main"}
          type="source"
          position={Position.Right}
          style={{ top: `${outputLayout.branches[0]?.topPct ?? 50}%` }}
          className={cn("!w-2.5 !h-2.5 !border-2 !border-[#181822]", branchHandleClass(outputLayout.branches[0]?.color ?? "violet"))}
        />
      )}
      <N8nCompactNodeBody
        kind={kind}
        label={label}
        selected={selected}
        enabled={data.enabled !== false}
        dimmed={!!data.dimmed}
      />
    </div>
  );
}

const nodeTypes = { wbahTrigger: TriggerNode, wbahN8nNode: N8nNode };

function EdgeInspector({
  edge,
  onDelete,
}: {
  edge: Edge | null;
  onDelete: () => void;
}) {
  if (!edge) return null;
  return (
    <div className="border-b border-amber-500/30 bg-amber-500/5 px-4 py-3 shrink-0 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-amber-200">Connection selected</p>
          <p className="text-[10px] font-mono text-gray-400 mt-1">
            {edge.source}
            {edge.sourceHandle ? ` [${edge.sourceHandle}]` : ""} → {edge.target}
          </p>
        </div>
        <Button size="sm" variant="destructive" className="h-7 text-[10px] shrink-0" onClick={onDelete}>
          <Trash2 className="h-3 w-3 mr-1" /> Remove wire
        </Button>
      </div>
      <p className="text-[9px] text-gray-600">Tip: click the purple line on canvas, then Delete / Backspace</p>
    </div>
  );
}

function FlowCanvasBody({
  config,
  syncKey,
  onChange,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectNodeLive,
  onSelectEdge,
  branchFilter,
  searchQuery,
  highlightEdgeIds,
  heightClass,
  layoutRevision,
}: {
  config: WbahPostCallWorkflowConfig;
  syncKey?: string | number | null;
  onChange: (cfg: WbahPostCallWorkflowConfig, meta: WbahFlowGraphMeta) => void;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectNodeLive?: (node: Node | null) => void;
  onSelectEdge: (id: string | null) => void;
  branchFilter: string;
  searchQuery: string;
  highlightEdgeIds: Set<string>;
  heightClass: string;
  layoutRevision: number;
}) {
  const { fitView, setCenter } = useReactFlow();
  const initial = useMemo(() => n8nGraphToReactFlow(config), [config]);
  const [nodes, setNodes] = useNodesState(initial.nodes as Node[]);
  const [edges, setEdges] = useEdgesState(initial.edges as Edge[]);
  const didInitialFit = useRef(false);

  const layoutKey =
    config.n8n_graph?.nodes?.map((n) => `${n.id}:${Math.round(n.position.x)}:${Math.round(n.position.y)}`).join("|") ??
    "";

  useEffect(() => {
    const g = n8nGraphToReactFlow(config);
    const q = searchQuery.trim().toLowerCase();
    const decorated = (g.nodes as Node[]).map((n) => {
      const branch = String((n.data as { branch?: string }).branch ?? "");
      const label = String((n.data as { label?: string }).label ?? "").toLowerCase();
      const dimBranch = branchFilter !== "all" && branch !== branchFilter && n.id !== "webhook";
      const dimSearch = q.length > 0 && !label.includes(q) && !n.id.includes(q) && n.id !== "webhook";
      return {
        ...n,
        data: { ...n.data, nodeId: n.id, dimmed: dimBranch || dimSearch },
        selected: n.id === selectedNodeId,
      };
    });
    setNodes(decorated);
    setEdges(
      (g.edges as Edge[]).map((e) => ({
        ...e,
        selected: e.id === selectedEdgeId,
        animated: highlightEdgeIds.has(e.id) || e.id === selectedEdgeId || e.animated,
        style: {
          stroke: highlightEdgeIds.has(e.id) || e.id === selectedEdgeId ? "#fbbf24" : "#a78bfa",
          strokeWidth: highlightEdgeIds.has(e.id) || e.id === selectedEdgeId ? 2.5 : 1.5,
        },
      })),
    );
  }, [syncKey, layoutKey, branchFilter, searchQuery, selectedNodeId, selectedEdgeId, highlightEdgeIds, setNodes, setEdges, config]);

  useEffect(() => {
    if (layoutRevision > 0 || !didInitialFit.current) {
      setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 80);
      didInitialFit.current = true;
    }
  }, [fitView, layoutRevision]);

  const emitChange = useCallback(
    (nextNodes: Node[], nextEdges: Edge[]) => {
      const nextCfg = reactFlowToN8nGraph(config, nextNodes, nextEdges);
      onChange(nextCfg, {
        nodes: nextNodes.map((n) => ({ id: n.id, position: n.position })),
        edges: nextEdges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          ...(e.sourceHandle ? { sourceHandle: String(e.sourceHandle) } : {}),
        })),
      });
    },
    [config, onChange],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => {
        const next = applyNodeChanges(changes, nds);
        const positionSaved = changes.some(
          (c) => c.type === "position" && "dragging" in c && c.dragging === false,
        );
        if (positionSaved) {
          setEdges((eds) => {
            emitChange(next, eds);
            return eds;
          });
        }
        const removed = changes.filter((c): c is NodeChange & { type: "remove"; id: string } => c.type === "remove");
        if (removed.length) {
          const removeIds = new Set(removed.map((c) => c.id).filter((id) => id !== "webhook"));
          if (removeIds.size) {
            setEdges((eds) => {
              const nextEdges = eds.filter(
                (e) => !removeIds.has(e.source) && !removeIds.has(e.target),
              );
              emitChange(
                next.filter((n) => n.id === "webhook" || !removeIds.has(n.id)),
                nextEdges,
              );
              return nextEdges;
            });
            onSelectNode(null);
          }
        }
        return next;
      });
    },
    [emitChange, setNodes, setEdges, onSelectNode],
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      const removeIds = new Set(deleted.map((n) => n.id).filter((id) => id !== "webhook"));
      if (!removeIds.size) return;
      setNodes((nds) => {
        const next = nds.filter((n) => !removeIds.has(n.id));
        setEdges((eds) => {
          const nextEdges = eds.filter(
            (e) => !removeIds.has(e.source) && !removeIds.has(e.target),
          );
          emitChange(next, nextEdges);
          return nextEdges;
        });
        return next;
      });
      onSelectNode(null);
    },
    [emitChange, setNodes, setEdges, onSelectNode],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => {
        const next = applyEdgeChanges(changes, eds);
        if (changes.some((c) => c.type === "remove")) {
          setNodes((ns) => {
            emitChange(ns, next);
            return ns;
          });
          onSelectEdge(null);
        }
        return next;
      });
    },
    [emitChange, setEdges, setNodes, onSelectEdge],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (!deleted.length) return;
      setEdges((eds) => {
        const removeIds = new Set(deleted.map((e) => e.id));
        const next = eds.filter((e) => !removeIds.has(e.id));
        setNodes((ns) => {
          emitChange(ns, next);
          return ns;
        });
        return next;
      });
      onSelectEdge(null);
    },
    [emitChange, setEdges, setNodes, onSelectEdge],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      setEdges((eds) => {
        const handle = conn.sourceHandle ?? "main";
        const edgeId = `e-${conn.source}-${handle}-${conn.target}`;
        const next = addEdge(
          {
            ...conn,
            id: edgeId,
            type: "smoothstep",
            animated: true,
            style: {
              stroke:
                handle === "error" || handle === "false" ? "#f87171" : "#a78bfa",
            },
            label: handle !== "main" ? handle : undefined,
            labelStyle: { fill: "#9ca3af", fontSize: 9 },
          },
          eds,
        );
        emitChange(nodes, next);
        return next;
      });
    },
    [nodes, emitChange, setEdges],
  );

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, __: Node, snapshot: Node[]) => {
      setEdges((eds) => {
        emitChange(snapshot, eds);
        return eds;
      });
    },
    [emitChange, setEdges],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onSelectEdge(null);
      onSelectNode(node.id);
      onSelectNodeLive?.(node);
      setCenter(node.position.x + 80, node.position.y + 24, { zoom: 0.9, duration: 300 });
    },
    [onSelectNode, onSelectNodeLive, onSelectEdge, setCenter],
  );

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      onSelectNode(null);
      onSelectEdge(edge.id);
    },
    [onSelectNode, onSelectEdge],
  );

  return (
    <div className={cn("wbah-n8n-flow w-full rounded-lg border border-gray-800 bg-[#0a0a0f] overflow-hidden", heightClass)}>
      <style>{WBAH_FLOW_CONTROL_STYLES}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onNodesDelete={onNodesDelete}
        onEdgesChange={handleEdgesChange}
        onEdgesDelete={onEdgesDelete}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={() => {
          onSelectNode(null);
          onSelectEdge(null);
        }}
        nodeTypes={nodeTypes}
        minZoom={0.08}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={["Backspace", "Delete"]}
        nodesDeletable
        nodesFocusable
        edgesDeletable
        edgesFocusable
        elementsSelectable
        defaultEdgeOptions={{ interactionWidth: 24, deletable: true, type: "smoothstep" }}
      >
        <Background gap={20} color="#1a1a28" />
        <Controls
          className="!bg-gray-900/95 !border-gray-600 !shadow-xl [&>button]:!text-gray-200"
          showInteractive
        />
        <MiniMap
          className="!bg-gray-950/95 !border-gray-700"
          pannable
          zoomable
          nodeColor={(n) => {
            const kind = String((n.data as { kind?: string })?.kind ?? "code");
            const map: Record<string, string> = {
              trigger: "#38bdf8",
              filter: "#fbbf24",
              if: "#fbbf24",
              merge: "#22d3ee",
              code: "#a78bfa",
              http: "#fb7185",
              wait: "#fb923c",
            };
            return map[kind] ?? "#6b7280";
          }}
        />
        <Panel position="bottom-left" className="!m-3">
          <p className="text-[9px] text-gray-600 bg-gray-950/90 border border-gray-800 rounded px-2 py-1">
            Click a node or wire · Delete/Backspace removes · webhook cannot be deleted
          </p>
        </Panel>
      </ReactFlow>
    </div>
  );
}

export type WbahPostCallFlowCanvasProps = {
  config: WbahPostCallWorkflowConfig;
  graphMeta: WbahFlowGraphMeta | null;
  syncKey?: string | number | null;
  onChange: (cfg: WbahPostCallWorkflowConfig, meta: WbahFlowGraphMeta) => void;
  fullscreen?: boolean;
  onCloseFullscreen?: () => void;
  onSave?: () => void;
  savePending?: boolean;
  onExecuteNode?: (args: { nodeId: string; pinData?: unknown }) => Promise<void>;
  executeNodePending?: boolean;
};

export function WbahPostCallFlowCanvas({
  config,
  syncKey,
  onChange,
  fullscreen = false,
  onCloseFullscreen,
  onSave,
  savePending,
  onExecuteNode,
  executeNodePending,
}: WbahPostCallFlowCanvasProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeLive, setSelectedNodeLive] = useState<Node | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightEdgeIds, setHighlightEdgeIds] = useState<Set<string>>(new Set());
  const [layoutRevision, setLayoutRevision] = useState(0);

  const graph = useMemo(() => n8nGraphToReactFlow(config), [config]);
  const edges = graph.edges as Edge[];

  useEffect(() => {
    setSelectedNodeId(null);
    setSelectedNodeLive(null);
    setSelectedEdgeId(null);
  }, [syncKey]);

  useEffect(() => {
    if (!selectedNodeId) {
      setSelectedNodeLive(null);
      return;
    }
    const fresh = (graph.nodes as Node[]).find((n) => n.id === selectedNodeId);
    if (fresh) setSelectedNodeLive(fresh);
  }, [config, selectedNodeId, graph.nodes]);

  const selectedNode = selectedNodeLive;
  const selectedEdge = useMemo(
    () => edges.find((e) => e.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId],
  );

  function patchConfig(next: WbahPostCallWorkflowConfig) {
    const meta: WbahFlowGraphMeta = {
      nodes: (next.n8n_graph?.nodes ?? []).map((n) => ({ id: n.id, position: n.position })),
      edges: next.n8n_graph?.edges ?? [],
    };
    onChange(next, meta);
  }

  function handleNodeUpdate(patch: {
    label?: string;
    enabled?: boolean;
    config?: Partial<WbahN8nNodeConfig>;
  }) {
    if (!selectedNodeId) return;
    let next = config;
    if (patch.label != null || patch.enabled != null) {
      next = updateN8nNodeInGraph(next, selectedNodeId, { label: patch.label, enabled: patch.enabled });
    }
    if (patch.config && Object.keys(patch.config).length > 0) {
      next = updateN8nNodeInGraph(next, selectedNodeId, {
        config: patch.config as Record<string, unknown>,
      });
    }
    patchConfig(next);
  }

  function handleDeleteEdge(edgeId: string) {
    patchConfig(removeEdgeFromN8nGraph(config, edgeId));
    setSelectedEdgeId(null);
  }

  function handleDeleteNode() {
    if (!selectedNodeId) return;
    patchConfig(removeN8nNodeFromGraph(config, selectedNodeId));
    setSelectedNodeId(null);
  }

  function handleAutoLayout() {
    patchConfig({ ...config, n8n_graph: autoLayoutN8nGraph(config.n8n_graph ?? resetN8nGraphLayout()) });
    setLayoutRevision((r) => r + 1);
  }

  function handleResetLayout() {
    patchConfig({ ...config, n8n_graph: resetN8nGraphLayout() });
    setLayoutRevision((r) => r + 1);
  }

  function highlightConnections() {
    if (!selectedNodeId) return;
    const ids = new Set(
      edges
        .filter((e) => e.source === selectedNodeId || e.target === selectedNodeId)
        .map((e) => e.id),
    );
    setHighlightEdgeIds(ids);
    setTimeout(() => setHighlightEdgeIds(new Set()), 3000);
  }

  const branches = useMemo(() => {
    const set = new Set<string>();
    for (const n of WBAH_N8N_NODE_CATALOG) set.add(n.branch);
    return ["all", ...Array.from(set)];
  }, []);

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 border-b border-gray-800 bg-gray-950/95 px-3 py-2 shrink-0">
      <div className="relative flex-1 min-w-[140px] max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search nodes…"
          className="h-8 pl-8 text-xs bg-gray-900 border-gray-700"
        />
      </div>
      <select
        value={branchFilter}
        onChange={(e) => setBranchFilter(e.target.value)}
        className="h-8 rounded-md border border-gray-700 bg-gray-900 text-xs px-2 text-gray-300"
      >
        {branches.map((b) => (
          <option key={b} value={b}>
            {b === "all" ? "All branches" : WBAH_N8N_BRANCH_LABELS[b] ?? b}
          </option>
        ))}
      </select>
      <Button size="sm" variant="outline" className="h-8 text-xs border-gray-700" onClick={handleAutoLayout}>
        <LayoutGrid className="h-3.5 w-3.5 mr-1" /> Auto-layout
      </Button>
      <Button size="sm" variant="outline" className="h-8 text-xs border-gray-700" onClick={handleResetLayout}>
        <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset
      </Button>
      {selectedNode && (
        <Badge variant="outline" className="text-[10px] border-violet-500/40 text-violet-300">
          Editing: {String(selectedNode.data?.label ?? selectedNode.id)}
        </Badge>
      )}
      {onSave && (
        <Button size="sm" className="h-8 text-xs bg-violet-600 hover:bg-violet-500" disabled={savePending} onClick={onSave}>
          {savePending ? "Saving…" : (
            <>
              <Save className="h-3.5 w-3.5 mr-1" /> Save
            </>
          )}
        </Button>
      )}
      {fullscreen && onCloseFullscreen && (
        <Button size="sm" variant="outline" className="h-8 text-xs border-gray-700 ml-auto" onClick={onCloseFullscreen}>
          <Minimize2 className="h-3.5 w-3.5 mr-1" /> Exit fullscreen
        </Button>
      )}
    </div>
  );

  const editorBody = (
    <div className={cn("flex flex-col min-h-0 flex-1", fullscreen ? "flex-1" : "min-h-[560px]")}>
      <div className="flex-1 min-w-0 min-h-[480px]">
        <ReactFlowProvider>
          <FlowCanvasBody
            config={config}
            syncKey={syncKey}
            onChange={onChange}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            onSelectNode={setSelectedNodeId}
            onSelectNodeLive={setSelectedNodeLive}
            onSelectEdge={setSelectedEdgeId}
            branchFilter={branchFilter}
            searchQuery={searchQuery}
            highlightEdgeIds={highlightEdgeIds}
            heightClass="h-full min-h-[480px] rounded-none border-0"
            layoutRevision={layoutRevision}
          />
        </ReactFlowProvider>
      </div>

      {selectedEdge && !selectedNode && (
        <EdgeInspector
          edge={selectedEdge}
          onDelete={() => selectedEdgeId && handleDeleteEdge(selectedEdgeId)}
        />
      )}

      <N8nNodeEditorModal
        open={!!selectedNode}
        onClose={() => {
          setSelectedNodeId(null);
          setSelectedNodeLive(null);
        }}
        title={
          selectedNode
            ? `${String(selectedNode.data?.label ?? selectedNode.id)} — node editor`
            : undefined
        }
      >
        {selectedNode && (
          <N8nNodeEditorLayout
            node={selectedNode}
            edges={edges}
            onUpdate={handleNodeUpdate}
            onDelete={() => {
              handleDeleteNode();
              setSelectedNodeId(null);
              setSelectedNodeLive(null);
            }}
            onClose={() => {
              setSelectedNodeId(null);
              setSelectedNodeLive(null);
            }}
            onFocusConnections={highlightConnections}
            onDeleteEdge={handleDeleteEdge}
            onExecuteStep={
              onExecuteNode && selectedNode
                ? async () => {
                    const cfg = (selectedNode.data?.config ?? {}) as WbahN8nNodeConfig;
                    await onExecuteNode({
                      nodeId: selectedNode.id,
                      pinData: cfg.pinData ?? cfg.lastExecution?.input,
                    });
                  }
                : undefined
            }
            executePending={executeNodePending}
          />
        )}
      </N8nNodeEditorModal>
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col bg-[#07070c]">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-950 shrink-0">
          <ZoomIn className="h-4 w-4 text-violet-400" />
          <p className="text-sm font-semibold text-gray-100">WBAH Flow Editor</p>
          <Badge variant="outline" className="text-[9px] border-gray-700">
            {(config.n8n_graph?.nodes ?? []).length} nodes
          </Badge>
          <div className="flex-1" />
          {onCloseFullscreen && (
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onCloseFullscreen}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        {toolbar}
        {editorBody}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 overflow-hidden bg-gray-950/50 min-h-[680px] flex flex-col flex-1">
      {toolbar}
      {editorBody}
    </div>
  );
}

export function WbahPostCallFlowEditorFullscreen(
  props: WbahPostCallFlowCanvasProps & { open: boolean; onCloseFullscreen?: () => void },
) {
  if (!props.open) return null;
  const { open: _open, ...rest } = props;
  return <WbahPostCallFlowCanvas {...rest} fullscreen onCloseFullscreen={props.onCloseFullscreen} />;
}

export function extractGraphMetaFromConfig(
  configRecord: Record<string, unknown> | null | undefined,
): WbahFlowGraphMeta | null {
  if (!configRecord) return null;
  const wf = configRecord.workflow as Record<string, unknown> | undefined;
  const n8n = wf?.n8n_graph as
    | { nodes?: Array<{ id: string; position: { x: number; y: number } }>; edges?: WbahFlowGraphMeta["edges"] }
    | undefined;
  if (n8n?.nodes?.length) {
    return { nodes: n8n.nodes.map((n) => ({ id: n.id, position: n.position })), edges: n8n.edges ?? [] };
  }
  return {
    nodes: (wf?.graph_nodes as WbahFlowGraphMeta["nodes"]) ?? [],
    edges: (wf?.graph_edges as WbahFlowGraphMeta["edges"]) ?? [],
  };
}
