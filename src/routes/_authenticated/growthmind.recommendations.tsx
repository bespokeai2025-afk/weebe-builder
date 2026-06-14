import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Loader2, RefreshCw, CheckCircle2, AlertTriangle,
  ChevronDown, ChevronUp, ExternalLink,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { getGrowthMindData } from "@/lib/growthmind/growthmind.functions";
import { generateGrowthRecommendations, type GrowthPriority } from "@/lib/growthmind/growthmind.recommendations";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/growthmind/recommendations")({
  head: () => ({ meta: [{ title: "Recommendations — GrowthMind" }] }),
  component: GrowthMindRecommendations,
});

const PRIORITY_COLORS: Record<GrowthPriority, { badge: string; border: string; icon: string }> = {
  critical: { badge: "bg-red-500/15 text-red-400 ring-red-500/20",       border: "border-red-500/20",    icon: "text-red-400" },
  high:     { badge: "bg-orange-500/15 text-orange-400 ring-orange-500/20", border: "border-orange-500/15", icon: "text-orange-400" },
  medium:   { badge: "bg-amber-500/15 text-amber-400 ring-amber-500/20",  border: "border-amber-500/15",  icon: "text-amber-400" },
  low:      { badge: "bg-slate-500/15 text-slate-400 ring-slate-500/20",  border: "border-white/[0.06]",  icon: "text-slate-400" },
};

const CATEGORIES = ["All", "Lead Response", "Pipeline", "Conversion", "Bookings", "Campaigns", "Agent Performance", "Channels", "Setup"];

function GrowthMindRecommendations() {
  const fn = useServerFn(getGrowthMindData);
  const qc = useQueryClient();
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["growthmind-data"],
    queryFn:  () => fn(),
    staleTime: 60_000,
  });

  const [filterPriority, setFilterPriority] = useState<"all" | GrowthPriority>("all");
  const [filterCategory, setFilterCategory] = useState("All");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const all      = generateGrowthRecommendations(data);
  const filtered = all.filter(r => {
    const pOk = filterPriority === "all" || r.priority === filterPriority;
    const cOk = filterCategory === "All" || r.category === filterCategory;
    return pOk && cOk;
  });

  const counts: Record<string, number> = {
    critical: all.filter(r => r.priority === "critical").length,
    high:     all.filter(r => r.priority === "high").length,
    medium:   all.filter(r => r.priority === "medium").length,
    low:      all.filter(r => r.priority === "low").length,
  };

  function toggle(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-4xl">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Growth Recommendations</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {all.length} marketing opportunit{all.length !== 1 ? "ies" : "y"} identified across your platform
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["growthmind-data"] })}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {/* Priority chips */}
        {!isLoading && (
          <div className="flex flex-wrap gap-2 mb-5">
            {(["all", "critical", "high", "medium", "low"] as const).map(p => {
              const cnt = p === "all" ? all.length : counts[p];
              const colors: Record<string, string> = {
                all:      "bg-white/[0.04] text-muted-foreground border-white/[0.08]",
                critical: "bg-red-500/10 text-red-400 border-red-500/20",
                high:     "bg-orange-500/10 text-orange-400 border-orange-500/20",
                medium:   "bg-amber-500/10 text-amber-400 border-amber-500/20",
                low:      "bg-slate-500/10 text-slate-400 border-slate-500/20",
              };
              return (
                <button
                  key={p}
                  onClick={() => setFilterPriority(p)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium border transition-all capitalize",
                    colors[p], filterPriority === p && "ring-1 ring-white/20",
                  )}
                >
                  {p === "all" ? "All" : p} ({cnt})
                </button>
              );
            })}
          </div>
        )}

        {/* Category filter */}
        {!isLoading && (
          <div className="flex flex-wrap gap-1.5 mb-5">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium border transition-colors",
                  filterCategory === cat
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                    : "bg-white/[0.02] text-muted-foreground border-white/[0.06] hover:text-foreground",
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
            <span className="text-sm">Analysing marketing data…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-400/60" />
            <p className="text-base font-semibold">
              {all.length === 0 ? "Great shape — no marketing issues detected" : "No items match these filters"}
            </p>
            <p className="text-sm text-muted-foreground">
              {all.length === 0
                ? "GrowthMind is monitoring your marketing pipeline continuously."
                : "Try changing the priority or category filter."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(r => {
              const c = PRIORITY_COLORS[r.priority];
              const open = expanded.has(r.id);
              return (
                <div key={r.id} className={cn("rounded-xl border bg-card/60 overflow-hidden transition-colors", c.border)}>
                  <button
                    className="w-full text-left flex items-start gap-3 px-4 py-3.5"
                    onClick={() => toggle(r.id)}
                  >
                    <AlertTriangle className={cn("h-4 w-4 shrink-0 mt-0.5", c.icon)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 capitalize", c.badge)}>
                          {r.priority}
                        </span>
                        <span className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[10px] text-muted-foreground">{r.category}</span>
                      </div>
                      <p className="text-sm font-semibold mt-1.5 leading-snug">{r.problem}</p>
                    </div>
                    {open
                      ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    }
                  </button>

                  {open && (
                    <div className="border-t border-white/[0.06] px-4 pb-4 pt-3 space-y-3">
                      <div className="rounded-lg bg-white/[0.025] p-3 space-y-2.5">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-1">Business Impact</p>
                          <p className="text-xs leading-relaxed text-foreground/80">{r.impact}</p>
                        </div>
                        <div className="border-t border-white/[0.04] pt-2.5">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-1">Recommended Action</p>
                          <p className="text-xs leading-relaxed text-foreground/80">{r.fix}</p>
                        </div>
                      </div>
                      {r.action && (
                        <Button asChild size="sm" variant="outline" className="h-7 text-xs gap-1.5">
                          <Link to={r.action.href}>
                            <ExternalLink className="h-3 w-3" />
                            {r.action.label}
                          </Link>
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </GrowthMindShell>
  );
}
