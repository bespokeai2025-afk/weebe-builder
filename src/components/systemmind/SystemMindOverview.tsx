import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  Server, Loader2, RefreshCw, ShieldCheck, ShieldAlert, AlertTriangle,
  CheckCircle2, XCircle, DollarSign, Activity, Sparkles, ArrowRight,
  GitBranch, Wrench, ShieldCheck as HealthIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SystemMindShell } from "./SystemMindShell";
import { getSystemMindData } from "@/lib/systemmind/systemmind.functions";
import { getSystemMindBriefing, buildSystemMindSummary } from "@/lib/systemmind/systemmind.ai";

const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-red-400 bg-red-500/10 border-red-500/20",
  high: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  medium: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  low: "text-slate-400 bg-slate-500/10 border-slate-500/20",
};

function ScoreRing({ score }: { score: number }) {
  const color = score >= 75 ? "text-sky-400" : score >= 50 ? "text-amber-400" : "text-red-400";
  return (
    <div className="relative flex h-24 w-24 items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="42" className="stroke-white/[0.06]" strokeWidth="8" fill="none" />
        <circle
          cx="50" cy="50" r="42" strokeWidth="8" fill="none" strokeLinecap="round"
          className={cn("transition-all", color)} stroke="currentColor"
          strokeDasharray={`${(score / 100) * 264} 264`}
        />
      </svg>
      <div className="text-center">
        <p className={cn("text-2xl font-bold leading-none", color)}>{score}</p>
        <p className="text-[9px] text-muted-foreground mt-0.5">/ 100</p>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon, accent, href }: {
  label: string; value: string | number; sub?: string; icon: React.ElementType;
  accent?: string; href?: string;
}) {
  const inner = (
    <div className={cn(
      "rounded-xl border p-4 transition-colors",
      href ? "cursor-pointer hover:bg-white/[0.04]" : "",
      accent === "amber"   ? "border-amber-500/20 bg-amber-500/[0.03]"
      : accent === "emerald" ? "border-emerald-500/20 bg-emerald-500/[0.03]"
      : accent === "red"     ? "border-red-500/20 bg-red-500/[0.03]"
      : "border-white/[0.06] bg-white/[0.02]",
    )}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className={cn(
          "h-3.5 w-3.5",
          accent === "amber" ? "text-amber-400"
          : accent === "emerald" ? "text-emerald-400"
          : accent === "red" ? "text-red-400"
          : "",
        )} />
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
        {href && <ArrowRight className="ml-auto h-3 w-3 opacity-40" />}
      </div>
      <p className="mt-2 text-2xl font-bold">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
  if (href) return <Link to={href}>{inner}</Link>;
  return inner;
}

export function SystemMindOverview() {
  const dataFn = useServerFn(getSystemMindData);
  const briefingFn = useServerFn(getSystemMindBriefing);
  const [briefing, setBriefing] = useState<string>("");
  const [briefingLoading, setBriefingLoading] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["systemmind-data"],
    queryFn: () => dataFn(),
  });

  const summary = data ? buildSystemMindSummary(data) : null;

  async function generateBriefing() {
    if (!data) return;
    setBriefingLoading(true);
    try {
      const res = await briefingFn({ data: { platformData: data } });
      setBriefing(res.briefing);
    } catch (e: any) {
      setBriefing(e?.message ?? "Could not generate briefing.");
    } finally {
      setBriefingLoading(false);
    }
  }

  return (
    <SystemMindShell>
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/20 ring-1 ring-sky-500/30">
              <Server className="h-5 w-5 text-sky-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">SystemMind</h1>
              <p className="text-xs text-muted-foreground">AI Chief Technology Officer — platform reliability, security & cost</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={cn("h-3.5 w-3.5", isRefetching && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !summary ? (
          <p className="py-24 text-center text-sm text-muted-foreground">No telemetry available.</p>
        ) : (
          <div className="mt-6 space-y-6">
            {/* Reliability + AI briefing */}
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.04] p-5 flex items-center gap-5">
                <ScoreRing score={summary.reliabilityScore} />
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Reliability</p>
                  <p className="text-lg font-bold text-sky-300">Grade {summary.grade}</p>
                  <p className="text-xs text-muted-foreground">{summary.label}</p>
                </div>
              </div>

              <div className="md:col-span-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-sky-400" />
                    <span className="text-sm font-semibold">AI Technical Briefing</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={generateBriefing} disabled={briefingLoading}>
                    {briefingLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Generate
                  </Button>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
                  {briefing || summary.headline}
                </p>
              </div>
            </div>

            {/* Stats */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Integrations" value={`${summary.integrations.connected}/${summary.integrations.total}`} sub="connected" icon={ShieldCheck} />
              <StatCard label="Runtime spend" value={`$${summary.cost.totalDollars.toFixed(2)}`} sub="provider usage" icon={DollarSign} />
              <StatCard label="Requests" value={summary.cost.requests} sub={`${summary.cost.errors} errors`} icon={Activity} />
              <StatCard label="Agents" value={data?.agents?.total ?? 0} sub="deployed" icon={Server} />
            </div>

            {/* Workflow Health */}
            {data?.workflowHealth ? (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-sky-400" /> Workflow Health
                  </h2>
                  <Link
                    to="/systemmind/workflows"
                    className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1"
                  >
                    View all <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatCard
                    label="Scanned"
                    value={data.workflowHealth.total}
                    sub="workflows in library"
                    icon={GitBranch}
                    href="/systemmind/workflows?tab=Library&health=all"
                  />
                  <StatCard
                    label="Passing"
                    value={`${data.workflowHealth.pctHealthy}%`}
                    sub={`${data.workflowHealth.healthy} healthy`}
                    icon={HealthIcon}
                    accent={data.workflowHealth.pctHealthy >= 80 ? "emerald" : data.workflowHealth.pctHealthy >= 50 ? "amber" : "red"}
                    href="/systemmind/workflows?tab=Library&health=healthy"
                  />
                  <StatCard
                    label="Need repair"
                    value={data.workflowHealth.needsRepair}
                    sub={
                      data.workflowHealth.needsRepair === 0
                        ? "all checks passing"
                        : data.workflowHealth.topRiskCategories.length > 0
                        ? data.workflowHealth.topRiskCategories.slice(0, 2).join(", ")
                        : "structural issues"
                    }
                    icon={Wrench}
                    accent={data.workflowHealth.needsRepair > 0 ? (data.workflowHealth.needsRepair >= Math.ceil(data.workflowHealth.total / 2) ? "red" : "amber") : "emerald"}
                    href="/systemmind/workflows?tab=Library&health=needs-repair"
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-sky-400" /> Workflow Health
                  </h2>
                </div>
                <p className="text-[12px] text-muted-foreground">
                  No workflows scanned yet.{" "}
                  <Link to="/systemmind/workflows" className="text-sky-400 hover:text-sky-300 underline underline-offset-2">
                    Go to Workflows → Library
                  </Link>{" "}
                  and run a scan to see health scores here.
                </p>
              </div>
            )}

            {/* Integration health grid */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
              <h2 className="text-sm font-semibold mb-3">Integration Health</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(summary.systemHealth).map(([key, ok]) => (
                  <div key={key} className="flex items-center gap-2 rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2">
                    {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <XCircle className="h-3.5 w-3.5 text-red-400/70" />}
                    <span className="text-xs capitalize">{key}</span>
                    <span className={cn("ml-auto text-[10px] font-medium", ok ? "text-emerald-400" : "text-muted-foreground")}>
                      {ok ? "Connected" : "Off"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Risks */}
            {summary.topRisks.length > 0 && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-400" /> Top Technical Risks
                </h2>
                <div className="space-y-2">
                  {summary.topRisks.map((r) => (
                    <div key={r.id} className={cn("rounded-lg border px-3 py-2.5", SEVERITY_COLOR[r.severity])}>
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <span className="text-xs font-semibold">{r.title}</span>
                        <span className="ml-auto text-[10px] uppercase opacity-70">{r.severity}</span>
                      </div>
                      <p className="mt-1 text-[11px] opacity-80">{r.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommended actions */}
            {summary.recommendedActions.length > 0 && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                <h2 className="text-sm font-semibold mb-3">Recommended Actions</h2>
                <div className="space-y-2">
                  {summary.recommendedActions.map((a) => (
                    <div key={a.id} className="flex items-start gap-3 rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold">{a.label}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{a.fix}</p>
                      </div>
                      {a.actionHref && (
                        <Link to={a.actionHref} className="shrink-0 text-sky-400 hover:text-sky-300">
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </SystemMindShell>
  );
}
