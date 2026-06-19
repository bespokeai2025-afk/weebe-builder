import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle, RefreshCw, Loader2, CheckCircle2, ArrowRight, Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SystemMindShell } from "./SystemMindShell";
import { getSystemMindIssues, generateSystemMindFixPlan } from "@/lib/systemmind/systemmind-cto.functions";
import type { SystemMindIssue } from "@/lib/systemmind/systemmind-cto.server";

const SEVERITY_STYLE: Record<string, string> = {
  critical: "text-red-400 border-red-500/30 bg-red-500/[0.04]",
  high:     "text-orange-400 border-orange-500/30 bg-orange-500/[0.04]",
  medium:   "text-amber-400 border-amber-500/30 bg-amber-500/[0.04]",
  low:      "text-slate-400 border-slate-500/30 bg-slate-500/[0.04]",
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400",
  high:     "bg-orange-500/15 text-orange-400",
  medium:   "bg-amber-500/15 text-amber-400",
  low:      "bg-slate-500/15 text-slate-400",
};

const CATEGORY_BADGE: Record<string, string> = {
  provider:      "bg-sky-500/10 text-sky-400",
  agent:         "bg-violet-500/10 text-violet-400",
  reliability:   "bg-rose-500/10 text-rose-400",
  security:      "bg-red-500/10 text-red-400",
  configuration: "bg-amber-500/10 text-amber-400",
  knowledge:     "bg-emerald-500/10 text-emerald-400",
};

const SEVERITY_ORDER = ["critical", "high", "medium", "low"];

function IssueCard({ issue, onFixPlan }: { issue: SystemMindIssue; onFixPlan: (issue: SystemMindIssue) => void }) {
  return (
    <div className={cn("rounded-xl border p-4 flex gap-3", SEVERITY_STYLE[issue.severity])}>
      <AlertTriangle className={cn("h-4 w-4 shrink-0 mt-0.5", SEVERITY_STYLE[issue.severity].split(" ")[0])} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 mb-1">
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", SEVERITY_BADGE[issue.severity])}>
            {issue.severity}
          </span>
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium capitalize", CATEGORY_BADGE[issue.category] ?? "bg-white/[0.05] text-muted-foreground")}>
            {issue.category}
          </span>
        </div>
        <p className="text-xs font-semibold">{issue.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{issue.detail}</p>
        <div className="flex gap-2 mt-2.5">
          <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs" onClick={() => onFixPlan(issue)}>
            <Wrench className="h-3 w-3" /> Create Fix Plan
          </Button>
          {issue.fixHref && (
            <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs" asChild>
              <a href={issue.fixHref}>Go to Settings <ArrowRight className="h-3 w-3" /></a>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function SystemMindIssuesPage() {
  const issuesFn = useServerFn(getSystemMindIssues);
  const fixPlanFn = useServerFn(generateSystemMindFixPlan);
  const navigate = useNavigate();
  const [creating, setCreating] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const { data: issues, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["systemmind-issues"],
    queryFn: () => issuesFn(),
    throwOnError: false,
  });

  async function handleFixPlan(issue: SystemMindIssue) {
    setCreating(issue.id);
    try {
      await fixPlanFn({ data: { title: issue.title, detail: issue.detail, sourceType: "issue", sourceId: issue.id } });
      navigate({ to: "/systemmind/fix-plans" });
    } catch {
      setCreating(null);
    }
  }

  const filtered = (issues ?? []).filter((i) => filter === "all" || i.severity === filter);
  const grouped = SEVERITY_ORDER.reduce<Record<string, SystemMindIssue[]>>((acc, sev) => {
    const items = filtered.filter((i) => i.severity === sev);
    if (items.length) acc[sev] = items;
    return acc;
  }, {});

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const i of issues ?? []) counts[i.severity as keyof typeof counts]++;

  return (
    <SystemMindShell>
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/15 ring-1 ring-red-500/25">
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Issues</h1>
              <p className="text-xs text-muted-foreground">Live platform health problems requiring attention</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={cn("h-3.5 w-3.5", isRefetching && "animate-spin")} /> Refresh
          </Button>
        </div>

        {/* Severity summary pills */}
        <div className="flex flex-wrap gap-2 mb-5">
          {(["all", "critical", "high", "medium", "low"] as const).map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
                filter === s ? "bg-sky-500/20 text-sky-300" : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08]",
              )}>
              {s === "all" ? `All (${(issues ?? []).length})` : `${s} (${counts[s as keyof typeof counts] ?? 0})`}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !issues?.length ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            <p className="text-sm font-medium text-emerald-400">No issues detected</p>
            <p className="text-xs text-muted-foreground">All monitored providers and agents look healthy.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([sev, items]) => (
              <div key={sev}>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">
                  {sev} — {items.length} {items.length === 1 ? "issue" : "issues"}
                </p>
                <div className="space-y-2">
                  {items.map((issue) => (
                    <IssueCard key={issue.id} issue={issue} onFixPlan={handleFixPlan} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SystemMindShell>
  );
}
