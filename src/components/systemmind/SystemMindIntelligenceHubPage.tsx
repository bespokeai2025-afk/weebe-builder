import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  BrainCircuit, Rocket, Gauge, GraduationCap, Loader2, History, Network, Search,
  ArrowRight, ShieldCheck, Boxes, GitBranch, Layers, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  getReadinessDashboardFn, getIntelligenceSettingsFn,
} from "@/lib/systemmind/intelligence.functions";
import { listTemplatesFn, getTemplateDetailFn } from "@/lib/systemmind/systemmind-templates.functions";
import { listKnowledgeGraphNodesFn, getNodeDependenciesFn } from "@/lib/systemmind/knowledge-graph.functions";
import { SystemMindShell } from "./SystemMindShell";
import { Chip, StatCard, MigrationNotice, ExecutionBanner, EmptyState } from "./intelligence/shared";

// ── Overview ───────────────────────────────────────────────────────────────────

const NAV_CARDS = [
  { to: "/systemmind/deployment-planner", icon: Rocket, title: "Deployment Planner", desc: "Turn a request into a complete, non-executed deployment plan." },
  { to: "/systemmind/deployment-readiness", icon: Gauge, title: "Deployment Readiness", desc: "Dashboard + per-template confidence scores." },
  { to: "/systemmind/learning", icon: GraduationCap, title: "Learning", desc: "Curation queue and suggested improvements." },
] as const;

function OverviewTab() {
  const dashFn = useServerFn(getReadinessDashboardFn);
  const setFn = useServerFn(getIntelligenceSettingsFn);
  const { data: dash, isLoading } = useQuery({ queryKey: ["systemmind-readiness"], queryFn: () => dashFn(), throwOnError: false });
  const { data: settings } = useQuery({ queryKey: ["systemmind-intel-settings"], queryFn: () => setFn(), throwOnError: false });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {NAV_CARDS.map((c) => (
          <Link key={c.to} to={c.to} className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 hover:bg-white/[0.04] hover:border-sky-500/30 transition-colors">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-500/15 ring-1 ring-sky-500/25">
                <c.icon className="h-3.5 w-3.5 text-sky-400" />
              </div>
              <p className="text-sm font-semibold">{c.title}</p>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 ml-auto group-hover:text-sky-400 group-hover:translate-x-0.5 transition-all" />
            </div>
            <p className="text-[11px] text-muted-foreground">{c.desc}</p>
          </Link>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : dash && dash.applied === false ? (
        <MigrationNotice what="SystemMind Intelligence" />
      ) : dash ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Templates" value={dash.templates.total} hint={`${dash.templates.approved} approved`} />
          <StatCard label="Recommended" value={dash.templates.recommended} hint={`threshold ${settings?.confidence_threshold ?? dash.threshold}`} tone="emerald" />
          <StatCard label="Avg confidence" value={dash.templates.avg_overall} tone={dash.templates.avg_overall >= 70 ? "emerald" : "amber"} />
          <StatCard label="Saved plans" value={dash.plans.total} hint={`${dash.plans.drafts} drafts`} />
        </div>
      ) : null}

      <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.04] p-4">
        <p className="text-[11px] font-semibold flex items-center gap-1.5 text-sky-200 mb-1.5">
          <ShieldCheck className="h-3.5 w-3.5" /> Execution boundary
        </p>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] rounded-full px-2 py-0.5 border border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-400">
            Autonomous deployment: {settings?.autonomous_deployment_enabled ? "ENABLED" : "disabled"}
          </span>
          <Chip className="text-emerald-400/80 border-emerald-500/20">plan-only</Chip>
        </div>
        <p className="text-[11px] text-muted-foreground">
          SystemMind Intelligence never deploys, provisions, or executes anything. It reads existing knowledge and produces
          descriptive plans and scores. Every deployment plan is stored as <code className="text-sky-300 bg-sky-500/[0.08] px-1 rounded text-[10px]">not_executed</code> and
          must be carried out by a human operator. There is no code path that enables autonomous execution.
        </p>
      </div>
    </div>
  );
}

// ── Version History ────────────────────────────────────────────────────────────

const STATUS_CLS: Record<string, string> = {
  approved: "text-emerald-400/80 border-emerald-500/20",
  pending_approval: "text-amber-400/80 border-amber-500/20",
  draft: "text-muted-foreground",
  archived: "text-muted-foreground/50",
};

function VersionHistoryTab() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const listFn = useServerFn(listTemplatesFn);
  const detailFn = useServerFn(getTemplateDetailFn);

  const { data: listData, isLoading } = useQuery({
    queryKey: ["systemmind-templates", "version-history"],
    queryFn: () => listFn({ data: {} }),
    throwOnError: false,
  });
  const { data: detail, isFetching } = useQuery({
    queryKey: ["systemmind-template-detail", selected],
    queryFn: () => detailFn({ data: { id: selected! } }),
    enabled: !!selected,
    throwOnError: false,
  });

  const templates = (listData?.templates ?? listData ?? []) as any[];
  const filtered = templates.filter((t: any) => !query || String(t.name).toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
      <div>
        <div className="relative mb-2">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search templates…" className="pl-7 h-8 text-xs" />
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
        ) : filtered.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/50 py-4 text-center">No templates.</p>
        ) : (
          <div className="space-y-1">
            {filtered.map((t: any) => (
              <button
                key={t.id}
                onClick={() => setSelected(t.id)}
                className={cn("w-full text-left rounded-lg border p-2.5 transition-colors", selected === t.id ? "border-sky-500/40 bg-sky-500/[0.08]" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]")}
              >
                <p className="text-xs font-medium truncate">{t.name}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Chip className={STATUS_CLS[t.status] ?? ""}>{t.status ?? "draft"}</Chip>
                  <Chip>v{t.current_version ?? 1}</Chip>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.01] p-4">
        {!selected ? (
          <EmptyState icon={History} title="Select a template" hint="Pick a template to view its version history." />
        ) : isFetching ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Loading versions…</div>
        ) : !detail ? (
          <EmptyState icon={History} title="Not found" />
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Boxes className="h-4 w-4 text-sky-400" />
              <p className="text-sm font-semibold">{detail.template?.name}</p>
              <Chip className="ml-auto">current v{detail.template?.current_version ?? 1}</Chip>
            </div>
            {(detail.versions ?? []).length === 0 ? (
              <p className="text-[11px] text-muted-foreground/60">No prior versions recorded yet.</p>
            ) : (
              <ol className="relative border-l border-white/[0.08] ml-1.5 space-y-3">
                {(detail.versions ?? []).map((v: any) => (
                  <li key={v.id} className="ml-4">
                    <span className="absolute -left-[5px] mt-1 h-2 w-2 rounded-full bg-sky-400" />
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">v{v.version}</span>
                      <Chip className={STATUS_CLS[v.status] ?? ""}>{v.status}</Chip>
                      <span className="text-[10px] text-muted-foreground/50 ml-auto">{v.created_at ? new Date(v.created_at).toLocaleString() : ""}</span>
                    </div>
                    {v.change_note && <p className="text-[11px] text-muted-foreground mt-0.5">{v.change_note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Dependencies ───────────────────────────────────────────────────────────────

function DependenciesTab() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const nodesFn = useServerFn(listKnowledgeGraphNodesFn);
  const depsFn = useServerFn(getNodeDependenciesFn);

  const { data: nodesData, isLoading } = useQuery({
    queryKey: ["systemmind-graph-nodes", "deps"],
    queryFn: () => nodesFn({ data: { limit: 500 } }),
    throwOnError: false,
  });
  const { data: deps, isFetching } = useQuery({
    queryKey: ["systemmind-node-deps", selected],
    queryFn: () => depsFn({ data: { nodeId: selected!, depth: 2 } }),
    enabled: !!selected,
    throwOnError: false,
  });

  const nodes = (nodesData?.nodes ?? nodesData ?? []) as any[];
  const filtered = nodes.filter((n: any) => !query || String(n.label).toLowerCase().includes(query.toLowerCase()) || String(n.node_type).toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
      <div>
        <div className="relative mb-2">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search nodes…" className="pl-7 h-8 text-xs" />
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
        ) : filtered.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/50 py-4 text-center">No graph nodes. Build the knowledge graph first.</p>
        ) : (
          <div className="space-y-1 max-h-[70vh] overflow-y-auto">
            {filtered.slice(0, 300).map((n: any) => (
              <button
                key={n.id}
                onClick={() => setSelected(n.id)}
                className={cn("w-full text-left rounded-lg border p-2 transition-colors", selected === n.id ? "border-sky-500/40 bg-sky-500/[0.08]" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]")}
              >
                <p className="text-[11px] font-medium truncate">{n.label}</p>
                <Chip className="mt-0.5">{String(n.node_type).replace(/_/g, " ")}</Chip>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.01] p-4">
        {!selected ? (
          <EmptyState icon={Network} title="Select a node" hint="Pick a node to trace its dependencies (2 hops)." />
        ) : isFetching ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Tracing…</div>
        ) : !deps?.root ? (
          <EmptyState icon={Network} title="No dependencies" hint="This node has no connected nodes." />
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <GitBranch className="h-4 w-4 text-sky-400" />
              <p className="text-sm font-semibold">{deps.root.label}</p>
              <Chip className="ml-auto">{deps.nodes.length} nodes · {deps.edges.length} edges</Chip>
            </div>
            {deps.root.summary && <p className="text-[11px] text-muted-foreground mb-3">{deps.root.summary}</p>}
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-1.5">Connections</p>
            <div className="space-y-1">
              {deps.edges.map((e: any) => {
                const from = deps.nodes.find((n: any) => n.id === e.from_node_id);
                const to = deps.nodes.find((n: any) => n.id === e.to_node_id);
                return (
                  <div key={e.id} className="flex items-center gap-1.5 text-[11px] text-foreground/80">
                    <Layers className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                    <span className="truncate max-w-[35%]">{from?.label ?? "?"}</span>
                    <ChevronRight className="h-3 w-3 text-sky-400/60 shrink-0" />
                    <span className="text-[9px] text-muted-foreground/60">{String(e.edge_type).replace(/_/g, " ")}</span>
                    <ChevronRight className="h-3 w-3 text-sky-400/60 shrink-0" />
                    <span className="truncate max-w-[35%]">{to?.label ?? "?"}</span>
                  </div>
                );
              })}
              {deps.edges.length === 0 && <p className="text-[11px] text-muted-foreground/50">No connections within 2 hops.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function SystemMindIntelligenceHubPage() {
  return (
    <SystemMindShell>
      <div className="p-5 max-w-6xl mx-auto">
        <div className="mb-4">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <BrainCircuit className="h-4.5 w-4.5 text-sky-400" /> SystemMind Intelligence
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            The hub for deployment planning, confidence scoring, template versions and dependency tracing — all descriptive.
          </p>
        </div>

        <div className="mb-4"><ExecutionBanner /></div>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList>
            <TabsTrigger value="overview" className="text-xs gap-1.5"><BrainCircuit className="h-3.5 w-3.5" /> Overview</TabsTrigger>
            <TabsTrigger value="versions" className="text-xs gap-1.5"><History className="h-3.5 w-3.5" /> Version History</TabsTrigger>
            <TabsTrigger value="dependencies" className="text-xs gap-1.5"><Network className="h-3.5 w-3.5" /> Dependencies</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-3"><OverviewTab /></TabsContent>
          <TabsContent value="versions" className="mt-3"><VersionHistoryTab /></TabsContent>
          <TabsContent value="dependencies" className="mt-3"><DependenciesTab /></TabsContent>
        </Tabs>
      </div>
    </SystemMindShell>
  );
}
