// GrowthMind → Command Centre — one honest picture of the whole content
// operation: pipeline, approvals, attention items and learning proposals.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  LayoutDashboard, Loader2, AlertTriangle, CheckCircle2, XCircle, Clock,
  TrendingUp, Wand2, Send, Brain, PlugZap, ExternalLink,
} from "lucide-react";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCommandCentreData } from "@/lib/growthmind/performance-views.server";
import { resolveLearnedPattern } from "@/lib/growthmind/learning-engine.server";

export const Route = createFileRoute("/_authenticated/growthmind/command-centre")({
  component: () => (
    <GrowthMindShell>
      <CommandCentrePage />
    </GrowthMindShell>
  ),
});

function StatCard({ label, value, icon: Icon, tone }: {
  label: string; value: number; icon: React.ElementType; tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className={cn("h-3.5 w-3.5",
          tone === "good" ? "text-emerald-400" : tone === "warn" ? "text-amber-400" : tone === "bad" ? "text-red-400" : "text-muted-foreground")} />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function CommandCentrePage() {
  const dataFn = useServerFn(getCommandCentreData);
  const resolveFn = useServerFn(resolveLearnedPattern);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["gm-command-centre"],
    queryFn:  () => dataFn(),
    staleTime: 30_000,
    throwOnError: false,
  });

  async function decide(patternId: string, decision: "accepted" | "rejected") {
    setBusy(patternId);
    try {
      await resolveFn({ data: { patternId, decision } });
      toast.success(decision === "accepted" ? "Learning accepted — it now steers future scoring." : "Learning rejected.");
      qc.invalidateQueries({ queryKey: ["gm-command-centre"] });
      qc.invalidateQueries({ queryKey: ["gm-performance-lab"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save the decision.");
    } finally { setBusy(null); }
  }

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-emerald-400" /></div>;
  }
  const d = data;
  if (!d) return <div className="p-6 text-sm text-muted-foreground">Command Centre data is unavailable right now — refresh to try again.</div>;

  const publishing = (d.jobCounts["scheduled"] ?? 0) + (d.jobCounts["approved"] ?? 0) + (d.jobCounts["publishing"] ?? 0);
  const brokenConns = d.connections.filter((c: any) =>
    c.status !== "connected" || (c.token_expires_at && new Date(c.token_expires_at).getTime() < Date.now()));

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <LayoutDashboard className="h-5 w-5 text-emerald-400" /> Command Centre
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your whole content operation in one place — pipeline, approvals, attention items and what GrowthMind is learning.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <StatCard label="Trend recommendations" value={d.trendCounts["recommended"] ?? 0} icon={TrendingUp} tone="good" />
        <StatCard label="In production" value={(d.projectCounts["in_production"] ?? 0) + (d.projectCounts["awaiting_assets"] ?? 0)} icon={Wand2} />
        <StatCard label="Awaiting approval" value={d.pendingApprovals.length} icon={Clock} tone={d.pendingApprovals.length ? "warn" : undefined} />
        <StatCard label="Queued to publish" value={publishing} icon={Send} />
        <StatCard label="Published (30d)" value={d.jobCounts["published"] ?? 0} icon={CheckCircle2} tone="good" />
        <StatCard label="Failed publishes" value={d.jobCounts["failed"] ?? 0} icon={XCircle} tone={(d.jobCounts["failed"] ?? 0) > 0 ? "bad" : undefined} />
      </div>

      {(brokenConns.length > 0 || d.attentionTasks.length > 0) && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-300">
            <AlertTriangle className="h-4 w-4" /> Needs attention
          </div>
          <ul className="mt-2 space-y-1.5">
            {brokenConns.map((c: any) => (
              <li key={c.id} className="text-sm text-muted-foreground">
                <PlugZap className="mr-1.5 inline h-3.5 w-3.5 text-amber-400" />
                Social connection <span className="text-foreground">{c.account_name ?? c.username ?? c.provider}</span> needs reconnecting —
                {" "}<Link to="/growthmind/social-accounts" className="text-emerald-400 underline-offset-2 hover:underline">fix it here</Link>.
              </li>
            ))}
            {d.attentionTasks.slice(0, 6).map((t: any) => (
              <li key={t.id} className="text-sm text-muted-foreground">
                <span className={cn("mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle",
                  t.priority === "high" ? "bg-red-400" : t.priority === "medium" ? "bg-amber-400" : "bg-slate-400")} />
                {t.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h2 className="flex items-center gap-2 text-sm font-medium"><Clock className="h-4 w-4 text-amber-400" /> Pending approvals</h2>
          {d.pendingApprovals.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nothing waiting on you.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {d.pendingApprovals.map((a: any) => (
                <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2">
                  <span className="truncate text-sm">{a.title}</span>
                  <div className="flex items-center gap-2">
                    {a.sensitive && <Badge variant="outline" className="border-amber-500/40 text-amber-300">rules</Badge>}
                    <Link to="/hivemind/actions" className="text-xs text-emerald-400 hover:underline">Review</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h2 className="flex items-center gap-2 text-sm font-medium"><Brain className="h-4 w-4 text-emerald-400" /> New learnings to review</h2>
          {d.proposedLearnings.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No new patterns yet — GrowthMind proposes learnings once enough published posts have snapshot data.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {d.proposedLearnings.slice(0, 5).map((p: any) => (
                <li key={p.id} className="rounded-lg bg-white/[0.03] px-3 py-2">
                  <p className="text-sm">{p.insight}</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" className="h-7 border-emerald-500/40 text-emerald-300"
                      disabled={busy === p.id} onClick={() => decide(p.id, "accepted")}>
                      {busy === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Accept"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-muted-foreground"
                      disabled={busy === p.id} onClick={() => decide(p.id, "rejected")}>Reject</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Full history and per-post results live in the{" "}
            <Link to="/growthmind/performance-lab" className="text-emerald-400 hover:underline">Performance Lab</Link>.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium"><Send className="h-4 w-4 text-emerald-400" /> Recent publishing</h2>
        {d.recentJobs.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing published in the last 30 days.</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/[0.04]">
            {d.recentJobs.map((j: any) => (
              <li key={j.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge variant="outline" className={cn(
                    j.status === "published" ? "border-emerald-500/40 text-emerald-300"
                    : j.status === "failed" ? "border-red-500/40 text-red-300"
                    : "border-white/10 text-muted-foreground")}>{j.status}</Badge>
                  <span className="truncate text-muted-foreground">{j.platform}{j.published_at ? ` · ${new Date(j.published_at).toLocaleString()}` : j.scheduled_at ? ` · scheduled ${new Date(j.scheduled_at).toLocaleString()}` : ""}</span>
                  {j.status === "failed" && j.error_message && (
                    <span className="truncate text-xs text-red-300/80">{String(j.error_message).slice(0, 120)}</span>
                  )}
                </div>
                {j.external_permalink && (
                  <a href={j.external_permalink} target="_blank" rel="noreferrer" className="shrink-0 text-emerald-400 hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
