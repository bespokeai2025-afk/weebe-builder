import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Share2, RefreshCw, Loader2, Search, Network, AlertTriangle, Info,
  Building2, Bot, Copy, GitBranch, Boxes, Cable, Waypoints, Brain,
  TrendingUp, Server, BarChart3, PlugZap, Zap, Rocket, Database, Circle,
  ArrowRight, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  buildKnowledgeGraphFn, getKnowledgeGraphSummaryFn,
  listKnowledgeGraphNodesFn, getNodeDependenciesFn,
} from "@/lib/systemmind/knowledge-graph.functions";
import {
  NODE_TYPE_META, EDGE_TYPE_META, type NodeType,
  type GraphSummary, type DependencyView, type GraphNode,
} from "@/lib/systemmind/knowledge-graph.schema";

const ICONS: Record<string, React.ElementType> = {
  Building2, Bot, Copy, GitBranch, Boxes, Cable, Waypoints, Brain,
  TrendingUp, Server, BarChart3, PlugZap, Share2, Zap, Rocket, Database,
};

function NodeIcon({ type, className }: { type: string; className?: string }) {
  const meta = NODE_TYPE_META[type as NodeType];
  const Icon = (meta && ICONS[meta.icon]) || Circle;
  return <Icon className={className} style={meta ? { color: meta.color } : undefined} />;
}

function typeLabel(t: string) {
  return NODE_TYPE_META[t as NodeType]?.label ?? t;
}

// ── Dependency viewer ─────────────────────────────────────────────────────────
function DependencyPanel({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const depsFn = useServerFn(getNodeDependenciesFn);
  const [depth, setDepth] = useState(2);
  const q = useQuery({
    queryKey: ["systemmind-graph-deps", nodeId, depth],
    queryFn: () => depsFn({ data: { nodeId, depth } }) as Promise<DependencyView>,
    throwOnError: false,
  });

  const byId = useMemo(
    () => new Map((q.data?.nodes ?? []).map((n) => [n.id, n])),
    [q.data],
  );

  return (
    <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/[0.03] p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold flex items-center gap-1.5">
          <Network className="h-3.5 w-3.5 text-indigo-400" /> Dependencies
        </p>
        <div className="flex items-center gap-2">
          <Select value={String(depth)} onValueChange={(v) => setDepth(Number(v))}>
            <SelectTrigger className="h-7 w-28 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4].map((d) => <SelectItem key={d} value={String(d)} className="text-xs">Depth {d}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      {q.isLoading && <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Tracing…</p>}
      {q.isError && <p className="text-[11px] text-red-400">Failed to load dependencies.</p>}

      {q.data?.root && (
        <>
          <div className="flex items-center gap-2 mb-3 pb-3 border-b border-white/[0.06]">
            <NodeIcon type={q.data.root.node_type} className="h-4 w-4" />
            <span className="text-sm font-semibold">{q.data.root.label}</span>
            <span className="text-[10px] text-muted-foreground">{typeLabel(q.data.root.node_type)}</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mb-2">
            {q.data.nodes.length} connected node(s), {q.data.edges.length} relationship(s) within depth {q.data.depth}.
          </p>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {q.data.edges.map((e) => {
              const from = byId.get(e.from_node_id);
              const to = byId.get(e.to_node_id);
              if (!from || !to) return null;
              return (
                <div key={e.id} className="flex items-center gap-1.5 text-[10px] rounded-md bg-white/[0.02] px-2 py-1.5">
                  <NodeIcon type={from.node_type} className="h-3 w-3 shrink-0" />
                  <span className="text-foreground/80 truncate max-w-[30%]">{from.label}</span>
                  <span className="text-muted-foreground/50 inline-flex items-center gap-0.5 shrink-0">
                    <ArrowRight className="h-2.5 w-2.5" />{EDGE_TYPE_META[e.edge_type as keyof typeof EDGE_TYPE_META]?.label ?? e.edge_type}<ArrowRight className="h-2.5 w-2.5" />
                  </span>
                  <NodeIcon type={to.node_type} className="h-3 w-3 shrink-0" />
                  <span className="text-foreground/80 truncate max-w-[30%]">{to.label}</span>
                </div>
              );
            })}
            {q.data.edges.length === 0 && (
              <p className="text-[11px] text-muted-foreground/60 py-2">No relationships within this depth.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function SystemMindKnowledgeGraphPage() {
  const qc = useQueryClient();
  const summaryFn = useServerFn(getKnowledgeGraphSummaryFn);
  const listNodesFn = useServerFn(listKnowledgeGraphNodesFn);
  const buildFn = useServerFn(buildKnowledgeGraphFn);

  const [nodeType, setNodeType] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const summary = useQuery({
    queryKey: ["systemmind-graph-summary"],
    queryFn: () => summaryFn() as Promise<GraphSummary>,
    throwOnError: false,
  });

  const nodes = useQuery({
    queryKey: ["systemmind-graph-nodes", nodeType, search],
    queryFn: () =>
      listNodesFn({ data: { nodeType: nodeType === "all" ? undefined : nodeType, search: search || undefined } }) as Promise<GraphNode[]>,
    throwOnError: false,
  });

  const build = useMutation({
    mutationFn: () => buildFn(),
    onSuccess: (res: any) => {
      toast.success(`Graph rebuilt — ${res.nodeCount} nodes, ${res.edgeCount} relationships.`);
      const errs = (res.sourceResults ?? []).filter((r: any) => r.error);
      if (errs.length) toast.warning(`${errs.length} source(s) reported issues.`);
      qc.invalidateQueries({ queryKey: ["systemmind-graph-summary"] });
      qc.invalidateQueries({ queryKey: ["systemmind-graph-nodes"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Rebuild failed."),
  });

  const nodeCounts = summary.data?.nodeCounts ?? {};
  const presentTypes = useMemo(
    () => Object.keys(nodeCounts).sort((a, b) => (nodeCounts[b] ?? 0) - (nodeCounts[a] ?? 0)),
    [nodeCounts],
  );

  const lastBuild = summary.data?.lastBuild;

  return (
    <div className="p-5 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Network className="h-4.5 w-4.5 text-indigo-400" /> Knowledge Graph
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            A connected map of everything WEBEE knows about this workspace — agents, workflows, integrations, executives,
            CRMs and infrastructure. Derived from existing data; read-only.
          </p>
        </div>
        <Button size="sm" className="gap-1.5 shrink-0" onClick={() => build.mutate()} disabled={build.isPending}>
          {build.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {build.isPending ? "Building…" : "Rebuild graph"}
        </Button>
      </div>

      {/* Empty / first-run state */}
      {summary.isSuccess && !lastBuild && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
          <Network className="h-8 w-8 text-indigo-400/50 mx-auto mb-2" />
          <p className="text-sm font-medium">No graph built yet</p>
          <p className="text-xs text-muted-foreground mt-1 mb-3">
            Build the knowledge graph to map this workspace's agents, workflows, integrations and more.
          </p>
          <Button size="sm" className="gap-1.5" onClick={() => build.mutate()} disabled={build.isPending}>
            {build.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Build graph
          </Button>
        </div>
      )}

      {lastBuild && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            <Stat label="Nodes" value={summary.data?.totalNodes ?? 0} />
            <Stat label="Relationships" value={summary.data?.totalEdges ?? 0} />
            <Stat label="Node types" value={presentTypes.length} />
            <Stat
              label="Last built"
              value={lastBuild.finished_at ? new Date(lastBuild.finished_at).toLocaleString() : "—"}
              small
            />
          </div>

          {/* Type legend / counts */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {presentTypes.map((t) => (
              <button
                key={t}
                onClick={() => setNodeType(nodeType === t ? "all" : t)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] transition-colors",
                  nodeType === t ? "border-indigo-500/40 bg-indigo-500/[0.1]" : "border-white/[0.08] hover:bg-white/[0.04]",
                )}
              >
                <NodeIcon type={t} className="h-3 w-3" />
                <span className="text-foreground/80">{typeLabel(t)}</span>
                <span className="text-muted-foreground/60">{nodeCounts[t]}</span>
              </button>
            ))}
          </div>

          {/* Source build results */}
          {lastBuild.errors?.length > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-2.5 mb-4">
              <p className="text-[11px] font-semibold text-amber-400 flex items-center gap-1.5 mb-1">
                <AlertTriangle className="h-3.5 w-3.5" /> {lastBuild.errors.length} source(s) reported issues
              </p>
              <div className="flex flex-wrap gap-1">
                {lastBuild.errors.map((e: any) => (
                  <span key={e.source} className="text-[9px] text-amber-400/70 border border-amber-500/20 rounded px-1.5 py-0.5">{e.source}</span>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Node list */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search nodes…" className="pl-7 h-8 text-xs" />
                </div>
                <Select value={nodeType} onValueChange={setNodeType}>
                  <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All types</SelectItem>
                    {presentTypes.map((t) => <SelectItem key={t} value={t} className="text-xs">{typeLabel(t)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {nodes.isLoading && <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 py-4"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading nodes…</p>}
              {nodes.isError && <p className="text-[11px] text-red-400 py-4">Failed to load nodes.</p>}

              <div className="space-y-1 max-h-[520px] overflow-y-auto pr-1">
                {(nodes.data ?? []).map((n) => (
                  <button
                    key={n.id}
                    onClick={() => setSelectedNode(n.id)}
                    className={cn(
                      "w-full text-left rounded-lg border p-2.5 transition-colors",
                      selectedNode === n.id ? "border-indigo-500/40 bg-indigo-500/[0.08]" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <NodeIcon type={n.node_type} className="h-3.5 w-3.5 shrink-0" />
                      <span className="text-xs font-medium truncate">{n.label}</span>
                      {n.status && <span className="text-[9px] text-muted-foreground/60 ml-auto shrink-0">{n.status}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="text-[9px] text-muted-foreground/50">{typeLabel(n.node_type)}</span>
                      {(n.tags ?? []).slice(0, 3).map((t) => (
                        <span key={t} className="text-[9px] border border-white/[0.08] rounded px-1 py-0.5 text-muted-foreground/60">{t}</span>
                      ))}
                    </div>
                  </button>
                ))}
                {nodes.isSuccess && (nodes.data ?? []).length === 0 && (
                  <p className="text-[11px] text-muted-foreground/60 py-4 text-center flex items-center justify-center gap-1.5">
                    <Info className="h-3.5 w-3.5" /> No nodes match.
                  </p>
                )}
              </div>
            </div>

            {/* Dependency viewer */}
            <div>
              {selectedNode ? (
                <DependencyPanel nodeId={selectedNode} onClose={() => setSelectedNode(null)} />
              ) : (
                <div className="rounded-xl border border-dashed border-white/[0.08] p-8 text-center h-full flex flex-col items-center justify-center">
                  <Network className="h-7 w-7 text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground">Select a node to trace its dependencies.</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {summary.isLoading && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading graph…
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: React.ReactNode; small?: boolean }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
      <p className="text-[10px] text-muted-foreground/60">{label}</p>
      <p className={cn("font-semibold", small ? "text-[11px] mt-0.5" : "text-lg")}>{value}</p>
    </div>
  );
}
