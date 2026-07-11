import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Loader2, Sparkles, HeartPulse, CheckCircle2, Circle, ArrowRight,
  ClipboardCheck, Activity, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SystemMindShell } from "./SystemMindShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { RelativeTime } from "@/components/ui/relative-time";
import {
  generateOnboardingPlan,
  getSetupChecklist,
  runWorkspaceHealthCheck,
  listHealthRuns,
} from "@/lib/systemmind/workspace-setup.functions";

function scoreColor(percent: number): string {
  if (percent >= 80) return "text-emerald-400";
  if (percent >= 50) return "text-amber-400";
  return "text-red-400";
}

export function SystemMindSetupAssistantPage() {
  const qc = useQueryClient();
  const [description, setDescription] = useState("");

  const generateFn  = useServerFn(generateOnboardingPlan);
  const checklistFn = useServerFn(getSetupChecklist);
  const healthFn    = useServerFn(runWorkspaceHealthCheck);
  const runsFn      = useServerFn(listHealthRuns);

  const { data: checklist, isLoading: checklistLoading } = useQuery({
    queryKey: ["workspace-setup-checklist"],
    queryFn: () => checklistFn(),
    throwOnError: false,
  });

  const { data: healthRuns } = useQuery({
    queryKey: ["workspace-health-runs"],
    queryFn: () => runsFn(),
    throwOnError: false,
  });

  const generateMut = useMutation({
    mutationFn: () => generateFn({ data: { description } }),
    onSuccess: (res: any) => {
      toast.success(`Setup plan "${res.draft?.title ?? "plan"}" drafted — review it on the Automation page.`);
      setDescription("");
      qc.invalidateQueries({ queryKey: ["systemmind-automation-drafts"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Generation failed"),
  });

  const healthMut = useMutation({
    mutationFn: () => healthFn(),
    onSuccess: (res: any) => {
      toast.success(`Health check complete — score ${res.percent}%. ${res.proposedActionIds.length} recommended actions proposed.`);
      qc.invalidateQueries({ queryKey: ["workspace-health-runs"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Health check failed"),
  });

  const latestRun = healthRuns?.find((r: any) => r.status === "complete");
  const latestPercent = latestRun && latestRun.max_score > 0
    ? Math.round((latestRun.score / latestRun.max_score) * 100)
    : null;

  return (
    <SystemMindShell>
      <div className="p-5 md:p-6 max-w-4xl space-y-6">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <ClipboardCheck className="h-4.5 w-4.5 text-sky-400" /> Setup Assistant
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            SystemMind drafts a setup checklist tailored to your business, then verifies each step against the real
            system state. The health check scores your workspace and proposes fixes — nothing is changed automatically.
          </p>
        </div>

        {/* Generate plan */}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
          <p className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-sky-400" /> Describe your business
          </p>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder='e.g. "We are a dental clinic that wants an AI receptionist answering calls, booking appointments via Cal.com, and following up on missed calls by WhatsApp."'
            className="min-h-24 text-xs"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm" className="h-8 text-xs"
              disabled={generateMut.isPending || description.trim().length < 10}
              onClick={() => generateMut.mutate()}
            >
              {generateMut.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
              Draft setup plan
            </Button>
            <Link to="/systemmind/automation" className="text-[11px] text-sky-400 hover:underline inline-flex items-center gap-1">
              Review &amp; approve drafts <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

        {/* Active checklist (derived completion) */}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm font-semibold flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-sky-400" /> Setup checklist
            </p>
            {checklist?.checklist && (
              <Badge variant="outline" className="text-[10px]">
                {checklist.doneCount}/{checklist.totalCount} verified complete
              </Badge>
            )}
          </div>
          {checklistLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking live workspace state…
            </div>
          ) : !checklist?.checklist ? (
            <p className="text-xs text-muted-foreground">
              No setup plan is active yet. Draft one above and approve it on the Automation page.
            </p>
          ) : (
            <>
              {checklist.checklist.business_summary && (
                <p className="text-[11px] text-muted-foreground">{checklist.checklist.business_summary}</p>
              )}
              <div className="space-y-1.5">
                {checklist.items.map((item: any, i: number) => (
                  <div key={i} className="flex items-start gap-2.5 rounded-lg border border-white/[0.04] bg-white/[0.015] px-3 py-2">
                    {item.done ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-xs font-medium", item.done && "line-through text-muted-foreground")}>
                        {item.title}
                      </p>
                      {item.why && !item.done && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">{item.why}</p>
                      )}
                    </div>
                    {!item.done && item.href && (
                      <Link to={item.href} className="text-[10px] text-sky-400 hover:underline shrink-0 inline-flex items-center gap-0.5">
                        Go <ArrowRight className="h-2.5 w-2.5" />
                      </Link>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Completion is verified live against the real system — checkmarks cannot be set manually.
              </p>
            </>
          )}
        </div>

        {/* Health check */}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm font-semibold flex items-center gap-2">
              <HeartPulse className="h-4 w-4 text-rose-400" /> Workspace health
            </p>
            <div className="flex items-center gap-2">
              {latestPercent != null && (
                <span className={cn("text-lg font-bold", scoreColor(latestPercent))}>{latestPercent}%</span>
              )}
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={healthMut.isPending} onClick={() => healthMut.mutate()}>
                {healthMut.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Activity className="mr-1.5 h-3.5 w-3.5" />}
                Run health check
              </Button>
            </div>
          </div>

          {latestRun ? (
            <>
              <p className="text-[11px] text-muted-foreground">
                {latestRun.summary} <RelativeTime date={latestRun.created_at} />
              </p>
              <div className="space-y-1">
                {(latestRun.findings ?? []).filter((f: any) => !f.passed).map((f: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] flex-wrap">
                    <AlertTriangle className={cn("h-3 w-3 shrink-0", f.weight >= 3 ? "text-red-400" : f.weight >= 2 ? "text-amber-400" : "text-muted-foreground")} />
                    <span className="font-medium">{f.label}</span>
                    <span className="text-muted-foreground">{f.detail}</span>
                    {f.recommended && (
                      <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400">action proposed</Badge>
                    )}
                  </div>
                ))}
                {(latestRun.findings ?? []).every((f: any) => f.passed) && (
                  <p className="text-[11px] text-emerald-400">All checks passing — workspace is fully configured.</p>
                )}
              </div>
              {(latestRun.proposed_action_ids ?? []).length > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  {(latestRun.proposed_action_ids ?? []).length} recommended fixes are waiting for approval in the{" "}
                  <Link to="/hivemind/actions" className="text-sky-400 hover:underline">HiveMind action centre</Link> — nothing is fixed automatically.
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              No health checks yet. Run one to get a scored report on this workspace's configuration.
            </p>
          )}
        </div>
      </div>
    </SystemMindShell>
  );
}
