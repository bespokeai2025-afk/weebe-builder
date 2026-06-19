import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  Library, Loader2, FileText, Layers, Search, Brain,
  TrendingUp, Server, Globe, ArrowRight, Sparkles,
  Database, CheckCircle2, Clock, BarChart3, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getExecutiveKnowledgeStats,
  seedExecutiveStarterKnowledge,
} from "@/lib/executives/executive-knowledge.functions";
import {
  getPlatformKnowledgeStats,
} from "@/lib/executives/platform-knowledge.server";
import { DEFAULT_EXECUTIVE_KBS, PLATFORM_EXECUTIVE_KBS } from "@/lib/executives/executive-knowledge.config";

const KB_ICON: Record<string, React.ElementType> = {
  hivemind:   Brain,
  growthmind: TrendingUp,
  systemmind: Server,
  shared:     Globe,
};
const KB_ACCENT: Record<string, string> = {
  hivemind:   "text-violet-400 bg-violet-500/15 ring-violet-500/30",
  growthmind: "text-emerald-400 bg-emerald-500/15 ring-emerald-500/30",
  systemmind: "text-sky-400 bg-sky-500/15 ring-sky-500/30",
  shared:     "text-amber-400 bg-amber-500/15 ring-amber-500/30",
};
// Icon and accent for platform KB slugs (strip the "platform_" prefix for lookup)
function platformIcon(slug: string): React.ElementType {
  return KB_ICON[slug.replace("platform_", "")] ?? Library;
}
function platformAccent(slug: string): string {
  return KB_ACCENT[slug.replace("platform_", "")] ?? "text-muted-foreground bg-white/[0.04] ring-white/[0.08]";
}

const MIND_LABEL: Record<string, string> = {
  hivemind:   "HiveMind",
  growthmind: "GrowthMind",
  systemmind: "SystemMind",
  shared:     "Shared",
};
const MIND_COLOR: Record<string, string> = {
  hivemind:   "text-violet-400",
  growthmind: "text-emerald-400",
  systemmind: "text-sky-400",
  shared:     "text-amber-400",
};

function Stat({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function KnowledgeCentreDashboard() {
  const statsFn    = useServerFn(getExecutiveKnowledgeStats);
  const seedFn     = useServerFn(seedExecutiveStarterKnowledge);
  const platformFn = useServerFn(getPlatformKnowledgeStats);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["executive-knowledge-stats"],
    queryFn:  () => statsFn(),
    throwOnError: false,
  });

  const { data: platformStats, isLoading: platformLoading } = useQuery({
    queryKey: ["platform-kb-stats"],
    queryFn:  () => platformFn(),
    throwOnError: false,
  });

  // Self-driving starter-knowledge seeding: batches until nothing remains.
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
          if (r.remaining === 0 || (r.processed === 0 && r.failed > 0)) break;
        }
      } catch {
        /* best-effort */
      } finally {
        if (!cancelled) { setSeeding(null); refetch(); }
      }
    })();
    return () => { cancelled = true; };
  }, [seedFn, refetch]);

  const perKbBySlug = new Map((data?.perKb ?? []).map((k: any) => [k.slug, k]));
  const totals  = data?.totals;
  const perMind: Record<string, number> = data?.perMindUsage ?? {};
  const mindKeys = Object.keys(perMind).sort((a, b) => (perMind[b] ?? 0) - (perMind[a] ?? 0));

  const platformPerKb = new Map((platformStats?.perKb ?? []).map((k: any) => [k.slug, k]));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 space-y-6">
      {/* Header */}
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

      {/* Seeding banner */}
      {seeding && (
        <div className="flex items-center gap-2.5 rounded-xl border border-violet-500/20 bg-violet-500/[0.06] px-4 py-3 text-xs text-violet-200">
          <Sparkles className="h-4 w-4 animate-pulse" />
          <span>
            Preparing starter knowledge — {seeding.total - seeding.remaining}/{seeding.total} ready…
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          {/* ── Stats row 1: KB-level totals ─────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Knowledge Bases"
              value={totals?.knowledgeBases ?? 0}
              icon={Database}
              sub="HiveMind, GrowthMind, SystemMind, Shared"
            />
            <Stat
              label="Indexed Files"
              value={totals?.indexedFiles ?? 0}
              sub={`${totals?.documents ?? 0} total uploaded`}
              icon={CheckCircle2}
            />
            <Stat
              label="Chunks Indexed"
              value={totals?.chunks ?? 0}
              sub="Semantic search chunks"
              icon={Layers}
            />
            <Stat
              label="Last Upload"
              value={formatRelative(totals?.lastUpload ?? null)}
              sub={totals?.lastUpload ? new Date(totals.lastUpload).toLocaleDateString() : "No uploads yet"}
              icon={Clock}
            />
          </div>

          {/* ── Stats row 2: usage totals ─────────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-3">
                <Search className="h-3.5 w-3.5" />
                <span className="text-[11px] font-medium uppercase tracking-wide">Total Retrievals</span>
              </div>
              <p className="text-2xl font-bold">{totals?.queries ?? 0}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">AI knowledge lookups across all executives</p>
            </div>

            {/* Per-mind usage breakdown */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-3">
                <BarChart3 className="h-3.5 w-3.5" />
                <span className="text-[11px] font-medium uppercase tracking-wide">Usage by Executive</span>
              </div>
              {mindKeys.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No retrievals yet</p>
              ) : (
                <div className="space-y-2">
                  {mindKeys.map((mind) => {
                    const count = perMind[mind] ?? 0;
                    const max   = perMind[mindKeys[0]] ?? 1;
                    const pct   = Math.round((count / max) * 100);
                    return (
                      <div key={mind}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className={cn("text-[11px] font-medium", MIND_COLOR[mind] ?? "text-foreground")}>
                            {MIND_LABEL[mind] ?? mind}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{count}</span>
                        </div>
                        <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                          <div
                            className={cn("h-full rounded-full", mind === "hivemind" ? "bg-violet-500/60" : mind === "growthmind" ? "bg-emerald-500/60" : mind === "systemmind" ? "bg-sky-500/60" : "bg-amber-500/60")}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Your Workspace Knowledge ──────────────────────────────── */}
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Your Workspace Knowledge
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {DEFAULT_EXECUTIVE_KBS.map((kb) => {
                const Icon = KB_ICON[kb.slug] ?? Library;
                const stat = perKbBySlug.get(kb.slug) as any;
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
                      <span className="text-emerald-400/80">{stat?.indexedCount ?? 0} indexed</span>
                      {(stat?.pendingCount ?? 0) > 0 && (
                        <span className="text-amber-400/80">{stat.pendingCount} pending</span>
                      )}
                      {(stat?.failedCount ?? 0) > 0 && (
                        <span className="text-red-400/80">{stat.failedCount} failed</span>
                      )}
                      <span className="ml-auto">{stat?.chunkCount ?? 0} chunks</span>
                    </div>
                    {stat?.lastUpload && (
                      <p className="mt-1 text-[10px] text-muted-foreground/50">
                        Last upload {formatRelative(stat.lastUpload)}
                      </p>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* ── Platform Knowledge (Provided by WEBEE) ────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck className="h-3.5 w-3.5 text-violet-400" />
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Platform Knowledge — Provided by WEBEE
              </h2>
              <span className="ml-auto text-[10px] rounded-full border border-violet-500/30 bg-violet-500/[0.08] px-2 py-0.5 text-violet-300">
                Read-only
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">
              WEBEE standard knowledge automatically available to all executives. Managed by the WEBEE platform team.
            </p>

            {platformLoading ? (
              <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading platform knowledge…
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {PLATFORM_EXECUTIVE_KBS.map((kb) => {
                  const Icon = platformIcon(kb.slug);
                  const stat = platformPerKb.get(kb.slug) as any;
                  return (
                    <div
                      key={kb.slug}
                      className="rounded-xl border border-violet-500/[0.12] bg-violet-500/[0.03] p-5"
                    >
                      <div className="flex items-start justify-between">
                        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg ring-1", platformAccent(kb.slug))}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <span className="text-[10px] rounded-full border border-violet-500/30 bg-violet-500/[0.08] px-2 py-0.5 text-violet-300">
                          WEBEE
                        </span>
                      </div>
                      <h3 className="mt-3 text-sm font-semibold">{kb.name}</h3>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground line-clamp-2">{kb.description}</p>
                      <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
                        <span>{stat?.docCount ?? 0} docs</span>
                        <span className="text-emerald-400/80">{stat?.indexed ?? 0} indexed</span>
                        {(stat?.pending ?? 0) > 0 && (
                          <span className="text-amber-400/80">{stat.pending} pending</span>
                        )}
                        <span className="ml-auto">{stat?.chunkCount ?? 0} chunks</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Recent retrievals ─────────────────────────────────────── */}
          {(data?.recentQueries?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                Recent Retrievals
              </h2>
              <div className="space-y-1.5">
                {data!.recentQueries.map((q: any) => (
                  <div key={q.id} className="flex items-center gap-3 text-[11px]">
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 font-medium capitalize", MIND_COLOR[q.mind_type] ?? "text-foreground", "bg-white/[0.04]")}>
                      {MIND_LABEL[q.mind_type] ?? q.mind_type}
                    </span>
                    <span className="truncate text-muted-foreground">{q.query}</span>
                    <span className="ml-auto shrink-0 text-muted-foreground/60">{q.matched_count} hits</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
