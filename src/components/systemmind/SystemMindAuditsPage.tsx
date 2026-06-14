import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ClipboardList, RefreshCw, Loader2, ChevronDown, ChevronRight, Play,
  CheckCircle2, AlertTriangle, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SystemMindShell } from "./SystemMindShell";
import { listSystemMindAudits, runSystemMindAudit } from "@/lib/systemmind/systemmind-cto.functions";

const FINDING_SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400",
  high:     "bg-orange-500/15 text-orange-400",
  medium:   "bg-amber-500/15 text-amber-400",
  low:      "bg-slate-500/15 text-slate-400",
  info:     "bg-sky-500/15 text-sky-400",
};

function ScorePill({ score }: { score: number | null }) {
  if (score === null) return null;
  const color = score >= 80 ? "text-emerald-400 bg-emerald-500/15" : score >= 60 ? "text-amber-400 bg-amber-500/15" : "text-red-400 bg-red-500/15";
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", color)}>{score}/100</span>;
}

function AuditRow({ audit }: { audit: any }) {
  const [open, setOpen] = useState(false);
  const findings: any[] = audit.findings ?? [];
  const critCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        {audit.status === "complete"
          ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          : audit.status === "failed"
          ? <XCircle className="h-4 w-4 text-red-400 shrink-0" />
          : <Loader2 className="h-4 w-4 text-sky-400 animate-spin shrink-0" />
        }
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold">
              {new Date(audit.run_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
            <ScorePill score={audit.score ?? null} />
            {critCount > 0 && <span className="text-[10px] bg-red-500/15 text-red-400 px-1.5 py-0.5 rounded">{critCount} critical</span>}
            {highCount > 0 && <span className="text-[10px] bg-orange-500/15 text-orange-400 px-1.5 py-0.5 rounded">{highCount} high</span>}
          </div>
          {audit.summary && <p className="text-xs text-muted-foreground mt-0.5 truncate">{audit.summary}</p>}
        </div>
        {findings.length > 0 && (
          open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
      </button>

      {open && findings.length > 0 && (
        <div className="border-t border-white/[0.06] divide-y divide-white/[0.04]">
          {findings.map((f, i) => (
            <div key={i} className="px-4 py-3 flex gap-3">
              <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase self-start mt-0.5", FINDING_SEVERITY_BADGE[f.severity] ?? FINDING_SEVERITY_BADGE.info)}>
                {f.severity}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-muted-foreground mb-0.5">{f.area}</p>
                <p className="text-xs">{f.finding}</p>
                {f.recommendation && (
                  <p className="text-xs text-sky-400/80 mt-1">→ {f.recommendation}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SystemMindAuditsPage() {
  const listFn = useServerFn(listSystemMindAudits);
  const runFn = useServerFn(runSystemMindAudit);
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const { data: audits, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["systemmind-audits"],
    queryFn: () => listFn(),
  });

  async function runAudit() {
    setRunning(true);
    try {
      await runFn({ data: {} });
      await refetch();
    } finally {
      setRunning(false);
    }
  }

  return (
    <SystemMindShell>
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/15 ring-1 ring-violet-500/25">
              <ClipboardList className="h-5 w-5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Audits</h1>
              <p className="text-xs text-muted-foreground">AI-powered platform health audits with scored findings</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={cn("h-3.5 w-3.5", isRefetching && "animate-spin")} />
            </Button>
            <Button size="sm" onClick={runAudit} disabled={running} className="bg-sky-600 hover:bg-sky-500 text-white">
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {running ? "Running audit…" : "Run Audit"}
            </Button>
          </div>
        </div>

        {running && (
          <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.04] px-4 py-3 mb-5 flex items-center gap-2">
            <Loader2 className="h-4 w-4 text-sky-400 animate-spin shrink-0" />
            <p className="text-xs text-sky-300">Audit running — analysing providers, agents, and platform health with AI. This takes ~15–30 seconds.</p>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !(audits as any[])?.length ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <ClipboardList className="h-10 w-10 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">No audits yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Click "Run Audit" to run a comprehensive AI health check on your platform.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {(audits as any[]).map((audit) => (
              <AuditRow key={audit.id} audit={audit} />
            ))}
          </div>
        )}
      </div>
    </SystemMindShell>
  );
}
