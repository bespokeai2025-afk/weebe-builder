import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Lightbulb, RefreshCw, Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SystemMindShell } from "./SystemMindShell";
import {
  listSystemMindRecommendations,
  generateSystemMindRecommendations,
  dismissSystemMindRecommendation,
} from "@/lib/systemmind/systemmind-cto.functions";

const PRIORITY_BADGE: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400",
  high:     "bg-orange-500/15 text-orange-400",
  medium:   "bg-amber-500/15 text-amber-400",
  low:      "bg-slate-500/15 text-slate-400",
};

const PRIORITY_ORDER = ["critical", "high", "medium", "low"];

const CATEGORIES = ["all", "security", "performance", "cost", "reliability", "configuration", "general"] as const;
type CategoryFilter = typeof CATEGORIES[number];

export function SystemMindRecommendationsPage() {
  const listFn = useServerFn(listSystemMindRecommendations);
  const generateFn = useServerFn(generateSystemMindRecommendations);
  const dismissFn = useServerFn(dismissSystemMindRecommendation);
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"open" | "dismissed" | "all">("open");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");

  const { data: recs, isLoading } = useQuery({
    queryKey: ["systemmind-recommendations"],
    queryFn: () => listFn(),
  });

  async function generate() {
    setGenerating(true);
    try {
      await generateFn({ data: {} });
      qc.invalidateQueries({ queryKey: ["systemmind-recommendations"] });
    } finally {
      setGenerating(false);
    }
  }

  async function dismiss(id: string) {
    setDismissing(id);
    try {
      await dismissFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["systemmind-recommendations"] });
    } finally {
      setDismissing(null);
    }
  }

  const allRecs = (recs ?? []) as any[];
  const openCount = allRecs.filter((r) => !r.dismissed_at).length;

  const filtered = allRecs.filter((r: any) => {
    const statusMatch =
      statusFilter === "all" ? true :
      statusFilter === "open" ? !r.dismissed_at :
      !!r.dismissed_at;
    const categoryMatch = categoryFilter === "all" ? true : r.category === categoryFilter;
    return statusMatch && categoryMatch;
  });

  const sorted = [...filtered].sort((a: any, b: any) => {
    const pa = PRIORITY_ORDER.indexOf(a.priority);
    const pb = PRIORITY_ORDER.indexOf(b.priority);
    return pa - pb;
  });

  return (
    <SystemMindShell>
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-amber-500/25">
              <Lightbulb className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Recommendations</h1>
              <p className="text-xs text-muted-foreground">AI-generated technical improvement suggestions</p>
            </div>
          </div>
          <Button size="sm" onClick={generate} disabled={generating} className="bg-sky-600 hover:bg-sky-500 text-white">
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {generating ? "Generating…" : "Generate"}
          </Button>
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-1.5 mb-3">
          {(["open", "dismissed", "all"] as const).map((f) => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-medium transition-colors capitalize",
                statusFilter === f ? "bg-sky-500/20 text-sky-300" : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08]",
              )}>
              {f === "open" ? `Open (${openCount})` : f === "all" ? `All (${allRecs.length})` : "Dismissed"}
            </button>
          ))}
        </div>

        {/* Category filter pills */}
        <div className="flex flex-wrap gap-1.5 mb-5">
          {CATEGORIES.map((cat) => (
            <button key={cat} onClick={() => setCategoryFilter(cat)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors capitalize",
                categoryFilter === cat
                  ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30"
                  : "bg-white/[0.03] text-muted-foreground/70 hover:bg-white/[0.07] border border-white/[0.06]",
              )}>
              {cat}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <Lightbulb className="h-10 w-10 text-amber-400/40" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">No recommendations yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Click "Generate" to have SystemMind analyse your platform and suggest improvements.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map((rec: any) => (
              <div key={rec.id} className={cn("rounded-xl border border-white/[0.06] bg-white/[0.02] p-4", rec.dismissed_at && "opacity-50")}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", PRIORITY_BADGE[rec.priority] ?? "bg-white/[0.05] text-muted-foreground")}>
                        {rec.priority}
                      </span>
                      <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-400 capitalize">
                        {rec.category}
                      </span>
                    </div>
                    <p className="text-xs font-semibold leading-snug">{rec.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{rec.body}</p>
                    <p className="text-[10px] text-muted-foreground/40 mt-2">
                      {new Date(rec.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  {!rec.dismissed_at && (
                    <button
                      onClick={() => dismiss(rec.id)}
                      disabled={dismissing === rec.id}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors"
                      title="Dismiss"
                    >
                      {dismissing === rec.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SystemMindShell>
  );
}
