import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Layers, RefreshCw, Loader2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SystemMindShell } from "./SystemMindShell";
import { getArchitectureLayers } from "@/lib/systemmind/systemmind-cto.functions";
import type { ArchitectureLayer } from "@/lib/systemmind/systemmind-cto.server";

function ComponentStatus({ status, note }: { status: "active" | "inactive" | "partial"; note?: string }) {
  const Icon = status === "active" ? CheckCircle2 : status === "partial" ? AlertCircle : XCircle;
  const cls = status === "active" ? "text-emerald-400" : status === "partial" ? "text-amber-400" : "text-red-400";
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={cn("h-3 w-3 shrink-0", cls)} />
      <span className={cn("text-xs leading-none", status === "inactive" ? "text-muted-foreground" : "text-foreground")}>
        {note ? `${note}` : ""}
      </span>
    </div>
  );
}

function LayerCard({ layer, isFirst, isLast }: { layer: ArchitectureLayer; isFirst: boolean; isLast: boolean }) {
  const allActive = layer.components.every((c) => c.status === "active");
  const anyInactive = layer.components.some((c) => c.status === "inactive");
  const borderColor = allActive
    ? "border-emerald-500/20"
    : anyInactive
    ? "border-red-500/20"
    : "border-amber-500/20";
  const bgColor = allActive
    ? "bg-emerald-500/[0.02]"
    : anyInactive
    ? "bg-red-500/[0.02]"
    : "bg-amber-500/[0.02]";
  const layerNumColor = allActive
    ? "bg-emerald-500/15 text-emerald-400"
    : anyInactive
    ? "bg-red-500/15 text-red-400"
    : "bg-amber-500/15 text-amber-400";

  return (
    <div className="relative flex gap-4">
      {/* Stack connector */}
      <div className="flex flex-col items-center">
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold", layerNumColor)}>
          {layer.order}
        </div>
        {!isLast && <div className="w-px flex-1 mt-1 bg-white/[0.06]" />}
      </div>

      <div className={cn("flex-1 rounded-xl border p-4 mb-3", borderColor, bgColor)}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <div>
            <p className="text-sm font-semibold">{layer.name}</p>
            <p className="text-[11px] text-sky-400 font-medium">{layer.role}</p>
          </div>
          <span className={cn(
            "shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded",
            allActive ? "bg-emerald-500/15 text-emerald-400" : anyInactive ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400",
          )}>
            {allActive ? "healthy" : anyInactive ? "issues" : "partial"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">{layer.description}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {layer.components.map((c) => (
            <div key={c.name} className="flex items-center gap-2">
              <ComponentStatus status={c.status} />
              <span className={cn("text-xs truncate", c.status === "inactive" ? "text-muted-foreground line-through" : "")}>{c.name}</span>
              {c.note && <span className="text-[10px] text-muted-foreground ml-auto shrink-0">({c.note})</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SystemMindArchitecturePage() {
  const layersFn = useServerFn(getArchitectureLayers);

  const { data: layers, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["systemmind-architecture"],
    queryFn: () => layersFn(),
    throwOnError: false,
  });

  const healthy = (layers ?? []).filter((l) => l.components.every((c) => c.status === "active")).length;

  return (
    <SystemMindShell>
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/15 ring-1 ring-violet-500/25">
              <Layers className="h-5 w-5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Architecture</h1>
              <p className="text-xs text-muted-foreground">Platform stack layers with live component status</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={cn("h-3.5 w-3.5", isRefetching && "animate-spin")} /> Refresh
          </Button>
        </div>

        {!isLoading && layers && (
          <div className="flex gap-4 mb-6">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-center flex-1">
              <p className="text-2xl font-bold text-emerald-400">{healthy}</p>
              <p className="text-[11px] text-muted-foreground">Healthy layers</p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-center flex-1">
              <p className="text-2xl font-bold">{(layers ?? []).length}</p>
              <p className="text-[11px] text-muted-foreground">Total layers</p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-center flex-1">
              <p className="text-2xl font-bold">{(layers ?? []).flatMap((l) => l.components).length}</p>
              <p className="text-[11px] text-muted-foreground">Components</p>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div>
            {(layers ?? []).map((layer, i) => (
              <LayerCard
                key={layer.id}
                layer={layer}
                isFirst={i === 0}
                isLast={i === (layers ?? []).length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </SystemMindShell>
  );
}
