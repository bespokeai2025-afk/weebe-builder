// GrowthMind → Performance Lab — checkpointed per-post results (attention /
// engagement / intent / conversion / revenue) plus the accept/reject queue of
// learned patterns that steer future scoring.
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  FlaskConical, Loader2, Brain, CheckCircle2, XCircle, ExternalLink, Eye,
  Heart, MousePointerClick, UserPlus, Banknote, AlertTriangle,
} from "lucide-react";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getPerformanceLabData } from "@/lib/growthmind/performance-views.server";
import { resolveLearnedPattern } from "@/lib/growthmind/learning-engine.server";

export const Route = createFileRoute("/_authenticated/growthmind/performance-lab")({
  component: () => (
    <GrowthMindShell>
      <PerformanceLabPage />
    </GrowthMindShell>
  ),
});

const CHECKPOINT_ORDER = ["1h", "6h", "24h", "72h", "7d", "30d"];

const CATEGORY_META: Array<{ key: string; label: string; icon: React.ElementType }> = [
  { key: "attention",  label: "Attention",  icon: Eye },
  { key: "engagement", label: "Engagement", icon: Heart },
  { key: "intent",     label: "Intent",     icon: MousePointerClick },
  { key: "conversion", label: "Conversion", icon: UserPlus },
  { key: "revenue",    label: "Revenue",    icon: Banknote },
];

function sumCat(cat: Record<string, number> | undefined): number {
  if (!cat) return 0;
  return Object.values(cat).reduce((s, v) => Math.max(s, Number(v) || 0), 0);
}

function PerformanceLabPage() {
  const dataFn = useServerFn(getPerformanceLabData);
  const resolveFn = useServerFn(resolveLearnedPattern);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["gm-performance-lab"],
    queryFn:  () => dataFn(),
    staleTime: 30_000,
    throwOnError: false,
  });

  async function decide(patternId: string, decision: "accepted" | "rejected") {
    setBusy(patternId);
    try {
      await resolveFn({ data: { patternId, decision } });
      toast.success(decision === "accepted" ? "Learning accepted — future scoring will use it." : "Learning rejected.");
      qc.invalidateQueries({ queryKey: ["gm-performance-lab"] });
      qc.invalidateQueries({ queryKey: ["gm-command-centre"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save the decision.");
    } finally { setBusy(null); }
  }

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-emerald-400" /></div>;
  }
  const posts = data?.posts ?? [];
  const patterns = data?.patterns ?? [];
  const proposed = patterns.filter((p: any) => p.status === "proposed");
  const decided  = patterns.filter((p: any) => p.status !== "proposed");

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <FlaskConical className="h-5 w-5 text-emerald-400" /> Performance Lab
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Checkpointed results for every published post (1h → 30d) and what GrowthMind is learning from them.
          Content is judged on leads and bookings, never views alone.
        </p>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium"><Brain className="h-4 w-4 text-emerald-400" /> Learnings awaiting your decision</h2>
        {proposed.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing to review. Patterns appear automatically once at least 3 published posts have snapshot data.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {proposed.map((p: any) => (
              <li key={p.id} className="rounded-lg bg-white/[0.03] px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">{String(p.pattern_kind).replaceAll("_", " ")}</Badge>
                  <span className="text-xs text-muted-foreground">based on {p.sample_size} post{p.sample_size === 1 ? "" : "s"} · confidence {(Number(p.confidence) * 100).toFixed(0)}%</span>
                </div>
                <p className="mt-1.5 text-sm">{p.insight}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {Number(p.adjustment) !== 0
                    ? `If accepted, future recommendation scores matching this pattern shift by ${Number(p.adjustment) > 0 ? "+" : ""}${Math.round(Number(p.adjustment) * 100)}%.`
                    : "Informational — used for scheduling advice, not scoring."}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" className="h-7 border-emerald-500/40 text-emerald-300"
                    disabled={busy === p.id} onClick={() => decide(p.id, "accepted")}>
                    {busy === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <><CheckCircle2 className="mr-1 h-3 w-3" /> Accept</>}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-muted-foreground"
                    disabled={busy === p.id} onClick={() => decide(p.id, "rejected")}>
                    <XCircle className="mr-1 h-3 w-3" /> Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {decided.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Decision history ({decided.length})</summary>
            <ul className="mt-2 space-y-1">
              {decided.slice(0, 20).map((p: any) => (
                <li key={p.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                  {p.status === "accepted"
                    ? <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
                    : <XCircle className="h-3 w-3 shrink-0 text-red-400" />}
                  <span className="truncate">{p.insight}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">Published posts ({posts.length})</h2>
        {posts.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No published posts in the last 60 days. Once content publishes through GrowthMind, snapshots appear here
            automatically at 1h, 6h, 24h, 72h, 7 days and 30 days.
          </p>
        )}
        {posts.map((post: any) => {
          const byCheckpoint: Record<string, any> = {};
          for (const s of post.snapshots) {
            const key = s.metrics?.checkpoint;
            if (key) byCheckpoint[key] = s;
          }
          const latest = post.snapshots[post.snapshots.length - 1];
          const cats = latest?.metrics?.categories ?? {};
          const attribution = latest?.metrics?.attribution ?? {};
          return (
            <div key={post.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{post.title ?? `${post.platform} ${post.target_type}`}</p>
                  <p className="text-xs text-muted-foreground">
                    {post.platform} · {post.target_type} · published {post.published_at ? new Date(post.published_at).toLocaleString() : "—"}
                  </p>
                </div>
                {post.external_permalink && (
                  <a href={post.external_permalink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-emerald-400 hover:underline">
                    View post <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {CATEGORY_META.map(({ key, label, icon: Icon }) => (
                  <div key={key} className="rounded-lg bg-white/[0.03] px-3 py-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3 w-3" /> {label}</div>
                    <div className="mt-0.5 text-lg font-semibold">{sumCat(cats[key]).toLocaleString()}</div>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {CHECKPOINT_ORDER.map((key) => {
                  const s = byCheckpoint[key];
                  const hadError = s?.metrics?.capture_error;
                  return (
                    <span key={key} title={hadError ? `Captured with an issue: ${hadError}` : s ? `Captured ${new Date(s.captured_at).toLocaleString()}` : "Not yet captured"}
                      className={cn("rounded-full border px-2 py-0.5 text-[11px]",
                        s && !hadError ? "border-emerald-500/40 text-emerald-300"
                        : s && hadError ? "border-amber-500/40 text-amber-300"
                        : "border-white/10 text-muted-foreground/60")}>
                      {key}{s && hadError ? " !" : ""}
                    </span>
                  );
                })}
                {latest?.metrics?.capture_error && (
                  <span className="flex items-center gap-1 text-[11px] text-amber-300">
                    <AlertTriangle className="h-3 w-3" /> Latest capture had an issue: {String(latest.metrics.capture_error).slice(0, 80)}
                  </span>
                )}
              </div>

              <p className="mt-2 text-xs text-muted-foreground">
                Leads and bookings are attributed with a time-window heuristic (social-sourced leads created after publish
                {attribution?.window?.from ? ` since ${new Date(attribution.window.from).toLocaleDateString()}` : ""}) — an honest estimate, not pixel tracking.
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
