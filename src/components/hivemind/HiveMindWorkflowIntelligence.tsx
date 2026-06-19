import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3, CheckCircle2, XCircle, Zap, Activity, TrendingUp,
  RefreshCw, Loader2, AlertCircle, Clock, Play,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  listWorkspaceWorkflows,
  listWorkflowRuns,
  getWorkflowEngineStats,
} from "@/lib/workflow-engine/workflow-engine.functions";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  active:    { label: "Active",    color: "text-emerald-400", icon: CheckCircle2 },
  inactive:  { label: "Inactive",  color: "text-muted-foreground", icon: Clock },
  paused:    { label: "Paused",    color: "text-amber-400",   icon: Clock },
  error:     { label: "Error",     color: "text-red-400",     icon: AlertCircle },
  running:   { label: "Running",   color: "text-blue-400",    icon: Loader2 },
  completed: { label: "Completed", color: "text-emerald-400", icon: CheckCircle2 },
  failed:    { label: "Failed",    color: "text-red-400",     icon: XCircle },
  skipped:   { label: "Skipped",   color: "text-muted-foreground", icon: Clock },
};

function StatCard({ label, value, sub, icon: Icon, iconColor }: { label: string; value: string | number; sub?: string; icon: React.ElementType; iconColor: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start gap-3">
          <div className={cn("p-2 rounded-lg mt-0.5", iconColor.replace("text-", "bg-").replace("400", "500/10").replace("500", "500/10"))}>
            <Icon className={cn("h-4 w-4", iconColor)} />
          </div>
          <div>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
            {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function HiveMindWorkflowIntelligence() {
  const qc = useQueryClient();
  const listWfFn  = useServerFn(listWorkspaceWorkflows);
  const listRunFn = useServerFn(listWorkflowRuns);
  const statsFn   = useServerFn(getWorkflowEngineStats);

  const wfQ    = useQuery({ queryKey: ["workspace-workflows"],   queryFn: () => listWfFn(),  throwOnError: false });
  const runsQ  = useQuery({ queryKey: ["workflow-runs"],          queryFn: () => listRunFn(), throwOnError: false });
  const statsQ = useQuery({ queryKey: ["workflow-engine-stats"], queryFn: () => statsFn(),   throwOnError: false });

  const workflows = wfQ.data ?? [];
  const runs      = runsQ.data ?? [];
  const stats     = statsQ.data;

  const successRate = stats && stats.total_runs > 0
    ? Math.round((stats.successful_runs / stats.total_runs) * 100)
    : null;

  const failureRate = stats && stats.total_runs > 0
    ? Math.round((stats.failed_runs / stats.total_runs) * 100)
    : null;

  // Per-workflow aggregation
  const wfRunMap: Record<string, { total: number; success: number; fail: number; lastRun: string | null }> = {};
  for (const run of runs as any[]) {
    if (!wfRunMap[run.workflow_id]) wfRunMap[run.workflow_id] = { total: 0, success: 0, fail: 0, lastRun: null };
    wfRunMap[run.workflow_id].total++;
    if (run.status === "completed") wfRunMap[run.workflow_id].success++;
    if (run.status === "failed")    wfRunMap[run.workflow_id].fail++;
    if (!wfRunMap[run.workflow_id].lastRun) wfRunMap[run.workflow_id].lastRun = run.started_at;
  }

  // Recommendations
  const recommendations: { level: "info" | "warn" | "error"; msg: string }[] = [];

  const errorWfs = (workflows as any[]).filter(w => w.status === "error");
  if (errorWfs.length > 0)
    recommendations.push({ level: "error", msg: `${errorWfs.length} workflow${errorWfs.length > 1 ? "s are" : " is"} in error state — review and fix.` });

  const inactiveWfs = (workflows as any[]).filter(w => w.status === "inactive");
  if (inactiveWfs.length > workflows.length * 0.5 && inactiveWfs.length > 1)
    recommendations.push({ level: "warn", msg: `${inactiveWfs.length} workflows are inactive — consider activating them.` });

  if (failureRate !== null && failureRate > 25)
    recommendations.push({ level: "warn", msg: `Workflow failure rate is ${failureRate}% — investigate failing steps.` });

  if (successRate !== null && successRate >= 90)
    recommendations.push({ level: "info", msg: `Excellent: ${successRate}% of runs completed successfully.` });

  if (workflows.length === 0)
    recommendations.push({ level: "info", msg: "No workflows deployed yet. Visit the Workflow Engine to create your first workflow." });

  const recentFailed = (runs as any[]).filter(r => r.status === "failed").slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Workflow Intelligence</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            HiveMind monitoring and insights across all workspace workflows.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => {
          qc.invalidateQueries({ queryKey: ["workspace-workflows"] });
          qc.invalidateQueries({ queryKey: ["workflow-runs"] });
          qc.invalidateQueries({ queryKey: ["workflow-engine-stats"] });
        }} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      {(statsQ.isLoading || stats) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total Workflows"  value={stats?.total_workflows ?? "—"}  icon={Zap}         iconColor="text-primary" />
          <StatCard label="Active"           value={stats?.active_workflows ?? "—"} icon={Activity}    iconColor="text-emerald-400" />
          <StatCard label="Total Runs"       value={stats?.total_runs ?? "—"}        icon={Play}        iconColor="text-blue-400" />
          <StatCard label="Successful"       value={stats?.successful_runs ?? "—"}   icon={CheckCircle2} iconColor="text-emerald-400" />
          <StatCard label="Failed"           value={stats?.failed_runs ?? "—"}       icon={XCircle}     iconColor="text-red-400" />
          <StatCard label="Success Rate"     value={successRate !== null ? `${successRate}%` : "—"} icon={TrendingUp} iconColor="text-violet-400" />
        </div>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">HiveMind Insights</p>
          {recommendations.map((r, i) => (
            <div key={i} className={cn(
              "flex items-start gap-2.5 px-4 py-3 rounded-lg border text-sm",
              r.level === "error" && "border-red-500/30 bg-red-500/5 text-red-300",
              r.level === "warn"  && "border-amber-500/30 bg-amber-500/5 text-amber-300",
              r.level === "info"  && "border-primary/20 bg-primary/5 text-muted-foreground",
            )}>
              {r.level === "error" && <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />}
              {r.level === "warn"  && <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />}
              {r.level === "info"  && <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-primary" />}
              {r.msg}
            </div>
          ))}
        </div>
      )}

      {/* Workflow Performance Table */}
      <div>
        <p className="text-sm font-medium text-muted-foreground mb-3">Workflow Performance</p>
        {wfQ.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading workflows…
          </div>
        )}
        {!wfQ.isLoading && workflows.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium text-sm">No workflows deployed</p>
            <p className="text-xs mt-1">Create workflows in the Workflow Engine to see performance data here.</p>
          </div>
        )}
        <div className="space-y-2">
          {(workflows as any[]).map(wf => {
            const agg = wfRunMap[wf.id] ?? { total: 0, success: 0, fail: 0, lastRun: null };
            const wfSuccess = agg.total > 0 ? Math.round((agg.success / agg.total) * 100) : null;
            const sc = STATUS_CONFIG[wf.status] ?? STATUS_CONFIG.inactive;
            const SIcon = sc.icon;
            return (
              <div key={wf.id} className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-card">
                <SIcon className={cn("h-4 w-4 shrink-0", sc.color)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{wf.name}</span>
                    <Badge variant="secondary" className="text-[10px]">{wf.trigger_type}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {agg.total} run{agg.total !== 1 ? "s" : ""}
                    {agg.last_run_at && ` · Last ${formatDistanceToNow(new Date(agg.lastRun!), { addSuffix: true })}`}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {wfSuccess !== null ? (
                    <span className={cn("text-sm font-semibold", wfSuccess >= 75 ? "text-emerald-400" : wfSuccess >= 50 ? "text-amber-400" : "text-red-400")}>
                      {wfSuccess}%
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">No runs</span>
                  )}
                  {agg.fail > 0 && <div className="text-xs text-red-400">{agg.fail} failed</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Failures */}
      {recentFailed.length > 0 && (
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-3">Recent Failures</p>
          <div className="space-y-2">
            {recentFailed.map((run: any) => (
              <div key={run.id} className="flex items-start gap-3 px-4 py-3 rounded-lg border border-red-500/20 bg-red-500/5">
                <XCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{run.workflow?.name ?? "Unknown workflow"}</div>
                  {run.error && <div className="text-xs text-red-400 mt-0.5 truncate">{run.error}</div>}
                </div>
                <div className="text-xs text-muted-foreground shrink-0">
                  {formatDistanceToNow(new Date(run.started_at), { addSuffix: true })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
