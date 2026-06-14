import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  Library, Loader2, FileText, Layers, Search, Brain, TrendingUp, Server, Globe, ArrowRight, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getExecutiveKnowledgeStats,
  seedExecutiveStarterKnowledge,
} from "@/lib/executives/executive-knowledge.functions";
import { DEFAULT_EXECUTIVE_KBS } from "@/lib/executives/executive-knowledge.config";

const KB_ICON: Record<string, React.ElementType> = {
  hivemind: Brain,
  growthmind: TrendingUp,
  systemmind: Server,
  shared: Globe,
};
const KB_ACCENT: Record<string, string> = {
  hivemind: "text-violet-400 bg-violet-500/15 ring-violet-500/30",
  growthmind: "text-emerald-400 bg-emerald-500/15 ring-emerald-500/30",
  systemmind: "text-sky-400 bg-sky-500/15 ring-sky-500/30",
  shared: "text-amber-400 bg-amber-500/15 ring-amber-500/30",
};

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: React.ElementType }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

export function KnowledgeCentreDashboard() {
  const statsFn = useServerFn(getExecutiveKnowledgeStats);
  const seedFn = useServerFn(seedExecutiveStarterKnowledge);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["executive-knowledge-stats"],
    queryFn: () => statsFn(),
  });

  // Self-driving starter-knowledge seeding: batches until nothing remains, then
  // refreshes stats. Idempotent server-side, so a single run per mount is safe.
  const seedStarted = useRef(false);
  const [seeding, setSeeding] = useState<{ remaining: number; total: number } | null>(null);
  useEffect(() => {
    if (seedStarted.current) return;
    seedStarted.current = true;
    let cancelled = false;
    (async () => {
      try {
        for (let i = 0; i < 12; i++) {
          const r = await seedFn({ data: { limit: 4 } });
          if (cancelled) return;
          if (r.remaining > 0) setSeeding({ remaining: r.remaining, total: r.total });
          // Stop if done, or if a batch made no progress (avoids infinite loop).
          if (r.remaining === 0 || (r.processed === 0 && r.failed > 0)) break;
        }
      } catch {
        /* seeding is best-effort; surfaced via empty KBs otherwise */
      } finally {
        if (!cancelled) {
          setSeeding(null);
          refetch();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seedFn, refetch]);

  const perKbBySlug = new Map((data?.perKb ?? []).map((k) => [k.slug, k]));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.04] ring-1 ring-white/[0.08]">
          <Library className="h-5 w-5 text-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Knowledge Centre</h1>
          <p className="text-xs text-muted-foreground">
            Private knowledge for your executive team — separate from customer-facing agent knowledge.
          </p>
        </div>
      </div>

      {seeding && (
        <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-violet-500/20 bg-violet-500/[0.06] px-4 py-3 text-xs text-violet-200">
          <Sparkles className="h-4 w-4 animate-pulse" />
          <span>
            Preparing starter knowledge for your executives — {seeding.total - seeding.remaining}/{seeding.total} ready…
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Documents" value={data?.totals.documents ?? 0} icon={FileText} />
            <Stat label="Chunks indexed" value={data?.totals.chunks ?? 0} icon={Layers} />
            <Stat label="Retrievals" value={data?.totals.queries ?? 0} icon={Search} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {DEFAULT_EXECUTIVE_KBS.map((kb) => {
              const Icon = KB_ICON[kb.slug] ?? Library;
              const stat = perKbBySlug.get(kb.slug);
              return (
                <Link
                  key={kb.slug}
                  to="/knowledge-centre/$slug"
                  params={{ slug: kb.slug }}
                  className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 transition-colors hover:border-white/[0.12] hover:bg-white/[0.04]"
                >
                  <div className="flex items-start justify-between">
                    <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg ring-1", KB_ACCENT[kb.slug])}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold">{kb.name}</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground line-clamp-2">{kb.description}</p>
                  <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
                    <span>{stat?.documentCount ?? 0} docs</span>
                    <span>{stat?.indexedCount ?? 0} indexed</span>
                    <span>{stat?.chunkCount ?? 0} chunks</span>
                  </div>
                </Link>
              );
            })}
          </div>

          {(data?.recentQueries?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
              <h2 className="text-sm font-semibold mb-3">Recent Retrievals</h2>
              <div className="space-y-1.5">
                {data!.recentQueries.map((q: any) => (
                  <div key={q.id} className="flex items-center gap-3 text-[11px]">
                    <span className="shrink-0 rounded bg-white/[0.05] px-1.5 py-0.5 font-medium capitalize">{q.mind_type}</span>
                    <span className="truncate text-muted-foreground">{q.query}</span>
                    <span className="ml-auto shrink-0 text-muted-foreground/60">{q.matched_count} hits</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
