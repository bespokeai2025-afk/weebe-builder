// GrowthMind → Competitor Intelligence — what monitored accounts are posting,
// what works for them, repeated topics and content gaps.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Eye, Loader2, ExternalLink, Radar, Lightbulb } from "lucide-react";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getCompetitorIntelligence } from "@/lib/growthmind/growthmind.trend-feed";

export const Route = createFileRoute("/_authenticated/growthmind/competitor-intel")({
  component: () => (
    <GrowthMindShell>
      <CompetitorIntelPage />
    </GrowthMindShell>
  ),
});

const KIND_LABEL: Record<string, string> = {
  competitor_direct:   "Direct competitor",
  competitor_indirect: "Indirect competitor",
  industry_creator:    "Industry creator",
  aspirational_brand:  "Aspirational brand",
  customer_account:    "Customer account",
};

function CompetitorIntelPage() {
  const intelFn = useServerFn(getCompetitorIntelligence);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["gm-competitor-intel"],
    queryFn:  () => intelFn(),
    staleTime: 60_000,
    throwOnError: false,
  });

  const accounts       = data?.accounts ?? [];
  const repeatedTopics = data?.repeatedTopics ?? [];
  const contentGaps    = data?.contentGaps ?? [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
          <Eye className="h-5 w-5 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-base font-semibold">Competitor Intelligence</h1>
          <p className="text-xs text-muted-foreground">
            What your monitored accounts posted in the last 30 days, what performed for them, and topics you haven't covered.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading intelligence…
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-xl border bg-card p-10 text-center space-y-2">
          <Eye className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No monitored accounts yet.</p>
          <p className="text-xs text-muted-foreground">
            Add competitors and creators under <Link to="/growthmind/trend-sources" className="text-emerald-400 hover:underline">Trend Sources</Link>, then run discovery from the <Link to="/growthmind/trend-feed" className="text-emerald-400 hover:underline">Trend Feed</Link>.
          </p>
        </div>
      ) : (
        <>
          {/* Topic intelligence */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border bg-card p-4 space-y-2">
              <div className="text-sm font-medium flex items-center gap-2">
                <Radar className="h-4 w-4 text-emerald-400" /> Repeated topics (30d)
              </div>
              {repeatedTopics.length === 0 ? (
                <p className="text-xs text-muted-foreground">Not enough content collected yet — run a few discoveries first.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {repeatedTopics.map(t => (
                    <Badge key={t.topic} variant="secondary" className="text-[11px]">
                      {t.topic} <span className="ml-1 text-muted-foreground">×{t.count}</span>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-xl border bg-card p-4 space-y-2">
              <div className="text-sm font-medium flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-400" /> Content gaps
              </div>
              <p className="text-[11px] text-muted-foreground">Topics competitors keep posting about that don't appear in your own recent content.</p>
              {contentGaps.length === 0 ? (
                <p className="text-xs text-muted-foreground">No clear gaps detected yet.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {contentGaps.map(t => (
                    <Badge key={t.topic} className="text-[11px] bg-amber-600/80">
                      {t.topic} <span className="ml-1 opacity-80">×{t.count}</span>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Per-account cards */}
          <div className="space-y-3">
            {accounts.map(acc => (
              <div key={acc.id} className="rounded-xl border bg-card">
                <div className="px-4 py-3 border-b flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{acc.label ?? acc.value}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {KIND_LABEL[acc.sourceKind] ?? acc.sourceKind}
                      {acc.platform ? ` · ${acc.platform}` : ""}
                      {acc.label ? ` · ${acc.value}` : ""}
                    </div>
                  </div>
                  <Badge variant={acc.status === "active" ? "default" : "secondary"}
                    className={cn("text-[10px]", acc.status === "active" && "bg-emerald-600")}>
                    {acc.status}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">{acc.postCount30d} items / 30d</Badge>
                </div>
                {acc.topPosts.length === 0 ? (
                  <div className="px-4 py-4 text-xs text-muted-foreground">
                    No content collected yet for this account. Instagram accounts need a connected Instagram professional account of your own (Business Discovery); YouTube needs a channel URL with a channel ID.
                  </div>
                ) : (
                  <div className="divide-y">
                    {acc.topPosts.map(p => {
                      const s = p.scores as any;
                      return (
                        <div key={p.id} className="px-4 py-2.5 flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs truncate">{p.title ?? p.caption?.slice(0, 140) ?? "(untitled)"}</div>
                            <div className="text-[10px] text-muted-foreground flex gap-2">
                              {p.mediaType && <span>{p.mediaType}</span>}
                              {p.publishedAt && mounted && <span>{new Date(p.publishedAt).toLocaleDateString()}</span>}
                              {Object.entries(p.metrics as Record<string, unknown>)
                                .filter(([k, v]) => typeof v === "number" && ["likes", "comments", "reactions", "shares", "upvotes", "views"].includes(k))
                                .slice(0, 3)
                                .map(([k, v]) => <span key={k}>{k}: {String(v)}</span>)}
                            </div>
                          </div>
                          {s?.momentum != null && (
                            <span className="text-xs font-semibold text-emerald-400 shrink-0">mom {s.momentum}</span>
                          )}
                          {p.url && (
                            <a href={p.url} target="_blank" rel="noreferrer" className="text-emerald-400 shrink-0">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
