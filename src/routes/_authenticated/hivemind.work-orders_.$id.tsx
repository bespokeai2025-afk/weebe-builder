/**
 * Work Order Detail — shows stage sequence, per-stage blockers, approval
 * state, and typed audit exceptions / field maps from the intelligence packet.
 *
 * Linked from the HiveMind Tasks page and from each Mind's dashboard via
 * the active-work-orders widget.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft, AlertTriangle, CheckCircle2, Clock, Loader2,
  ShieldCheck, Database, Target, ClipboardList, TrendingUp,
  ChevronRight, Ban, Zap, GitBranch, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HiveMindShell } from "@/components/hivemind/HiveMindShell";
import { RelativeTime } from "@/components/ui/relative-time";
import { IntelligencePacketPanel, ReadinessBadge } from "@/components/minds/IntelligencePacketPanel";
import type { UniversalMindIntelligencePacket } from "@/lib/minds/intelligence-packet.shared";
import { GadsAnalysisReportViewer } from "@/components/growthmind/GadsAnalysisReportViewer";
import { getGadsAnalysisReport } from "@/lib/growthmind/gads-analysis-report.server";
import {
  getWorkOrderDetail,
  workOrderStatusLabel,
  workOrderProgressPct,
  stageReadinessLabel,
  stageIsApprovable,
  stageBlockers,
  packetAuditFindings,
  type WorkOrderSummary,
  type WorkOrderStageTask,
} from "@/lib/hivemind/work-orders-query.server";

export const Route = createFileRoute("/_authenticated/hivemind/work-orders_/$id")({
  head: () => ({ meta: [{ title: "Work Order — Webee" }] }),
  component: WorkOrderDetailPage,
});

// ── Status styles ─────────────────────────────────────────────────────────────

const WO_STATUS_STYLES: Record<string, string> = {
  open:                "bg-sky-500/15 text-sky-400 border-sky-500/25",
  in_progress:         "bg-amber-500/15 text-amber-400 border-amber-500/25",
  awaiting_approval:   "bg-violet-500/15 text-violet-400 border-violet-500/25",
  blocked:             "bg-red-500/15 text-red-400 border-red-500/25",
  partially_completed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  completed:           "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  cancelled:           "bg-slate-500/15 text-slate-400 border-slate-500/25",
  failed:              "bg-red-500/15 text-red-400 border-red-500/25",
};

// ── Stage task card ───────────────────────────────────────────────────────────

function StageCard({ task, index, total }: { task: WorkOrderStageTask; index: number; total: number }) {
  const blockers = stageBlockers(task);
  const approvable = stageIsApprovable(task.readiness_state);
  const isBlocked = task.readiness_state === "blocked" || task.readiness_state === "integration_required";
  const isComplete = task.status === "completed";
  const isFinalSend = !!(task.metadata as any)?.final_send_stage;
  const approvalStageLabel = (task.metadata as any)?.approval_stage_label ?? null;
  const packet = task.intelligence_packet as UniversalMindIntelligencePacket | null;
  const findings = packetAuditFindings(packet);

  return (
    <div className="relative flex gap-4">
      {/* Connector line */}
      {index < total - 1 && (
        <div className="absolute left-[19px] top-10 bottom-0 w-px bg-white/[0.06]" />
      )}

      {/* Step circle */}
      <div className={cn(
        "h-10 w-10 rounded-full border-2 flex items-center justify-center shrink-0 z-10",
        isComplete
          ? "border-emerald-500/50 bg-emerald-500/15"
          : isBlocked
          ? "border-red-500/40 bg-red-500/[0.06]"
          : approvable
          ? "border-violet-500/40 bg-violet-500/10"
          : "border-white/[0.1] bg-white/[0.03]",
      )}>
        {isComplete
          ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          : isBlocked
          ? <AlertTriangle className="h-4 w-4 text-red-400" />
          : approvable
          ? <ShieldCheck className="h-4 w-4 text-violet-400" />
          : <Clock className="h-4 w-4 text-muted-foreground/50" />}
      </div>

      {/* Content */}
      <div className={cn(
        "flex-1 rounded-xl border p-4 mb-4",
        isComplete
          ? "border-emerald-500/15 bg-emerald-500/[0.03]"
          : isBlocked
          ? "border-red-500/15 bg-red-500/[0.03]"
          : approvable
          ? "border-violet-500/20 bg-violet-500/[0.04]"
          : "border-white/[0.07] bg-white/[0.02]",
      )}>
        {/* Stage header */}
        <div className="flex items-start gap-3 flex-wrap mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {approvalStageLabel && (
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Stage {index + 1} · {approvalStageLabel}
                </span>
              )}
              {isFinalSend && (
                <span className="inline-flex items-center gap-1 text-[10px] rounded-full px-1.5 py-0.5 bg-orange-500/15 text-orange-400 border border-orange-500/25 font-medium">
                  <Zap className="h-2.5 w-2.5" /> Final Send
                </span>
              )}
            </div>
            <p className="text-sm font-semibold">{task.title}</p>
            {task.description && (
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{task.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <ReadinessBadge state={task.readiness_state} />
            <span className={cn(
              "text-[10px] rounded-full px-1.5 py-0.5 border font-medium capitalize",
              task.status === "completed"
                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
                : task.status === "in_progress"
                ? "bg-amber-500/15 text-amber-400 border-amber-500/25"
                : task.status === "approved"
                ? "bg-blue-500/15 text-blue-400 border-blue-500/25"
                : "bg-white/[0.05] text-muted-foreground border-white/[0.1]",
            )}>
              {task.status.replace(/_/g, " ")}
            </span>
          </div>
        </div>

        {/* Blockers */}
        {blockers.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {blockers.map((b, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2">
                <Ban className="h-3 w-3 text-red-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-red-300/90 leading-relaxed">{b}</p>
              </div>
            ))}
          </div>
        )}

        {/* Audit findings (typed data extracted from evidence) */}
        {findings.length > 0 && (
          <div className="mb-3">
            <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide mb-2">
              <BarChart3 className="h-3 w-3" /> Audit Findings
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {findings.map((f, i) => (
                <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                  <p className="text-[10px] text-muted-foreground">{f.label}</p>
                  <p className={cn(
                    "text-sm font-semibold tabular-nums",
                    typeof f.value === "number" && f.value > 0 ? "text-amber-300" : "text-foreground",
                  )}>
                    {f.value ?? "—"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Approval scope summary */}
        {packet?.approval_scope && (
          <div className="rounded-lg border border-sky-500/15 bg-sky-500/[0.03] px-3 py-2 mb-3">
            <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
              <ShieldCheck className="h-3 w-3 text-sky-400" /> Approval scope
            </p>
            <p className="text-[11px] text-foreground/85 leading-relaxed">{packet.approval_scope.summary}</p>
            {packet.approval_scope.sensitive && (
              <p className="text-[10px] text-amber-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Sensitive — not auto-executed
              </p>
            )}
          </div>
        )}

        {/* Evidence sources */}
        {packet && packet.evidence.length > 0 && (
          <div className="mb-3">
            <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">
              <Database className="h-3 w-3" /> Evidence
            </p>
            <ul className="space-y-1">
              {packet.evidence.map((e, i) => (
                <li key={i} className="text-[11px] text-foreground/70 leading-relaxed">
                  <span className="text-muted-foreground">{e.source}:</span>{" "}
                  {e.description}
                  <span className="text-muted-foreground/50 ml-1">
                    (<RelativeTime date={e.retrieved_at} short />)
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Approval-ready CTA */}
        {approvable && !isComplete && (
          <div className="flex items-center gap-2 pt-1">
            <Link
              to="/hivemind/tasks"
              className="flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-[11px] font-medium text-violet-400 hover:bg-violet-500/20 transition-all"
            >
              <ShieldCheck className="h-3 w-3" />
              Approve in Tasks
              <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground/40 mt-2 text-right">
          Updated <RelativeTime date={task.updated_at} short />
        </p>
      </div>
    </div>
  );
}

// ── Work order header ─────────────────────────────────────────────────────────

function WorkOrderHeader({ wo }: { wo: WorkOrderSummary }) {
  const pct = workOrderProgressPct(wo);
  const statusLabel = workOrderStatusLabel(wo.status);
  const statusStyle = WO_STATUS_STYLES[wo.status] ?? "bg-white/[0.05] text-muted-foreground border-white/[0.1]";
  const mainBlockers = (wo.intelligence_packet?.blockers ?? []);

  return (
    <div className="border-b border-white/[0.07] px-5 py-5">
      <div className="flex items-start gap-3 mb-4 flex-wrap">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15 ring-1 ring-violet-500/25 shrink-0">
          <GitBranch className="h-5 w-5 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={cn("text-[10px] rounded-full px-1.5 py-0.5 border font-medium", statusStyle)}>
              {statusLabel}
            </span>
            {wo.channel_kind && (
              <span className="text-[10px] text-muted-foreground/60 bg-white/[0.04] rounded-full px-1.5 py-0.5 capitalize">
                {wo.channel_kind.replace(/_/g, " ")}
              </span>
            )}
            {wo.assigned_minds.map((m) => (
              <span key={m} className="text-[10px] text-muted-foreground/60 bg-white/[0.04] rounded-full px-1.5 py-0.5 capitalize">
                {m}
              </span>
            ))}
          </div>
          <h1 className="text-base font-semibold leading-snug">{wo.title}</h1>
          {wo.objective && (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{wo.objective}</p>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Stages</p>
          <p className="text-lg font-bold tabular-nums">{wo.stage_count}</p>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Completed</p>
          <p className="text-lg font-bold tabular-nums text-emerald-400">{wo.completed_stages}</p>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Blockers</p>
          <p className={cn("text-lg font-bold tabular-nums", wo.blocker_count > 0 ? "text-red-400" : "text-foreground")}>
            {wo.blocker_count}
          </p>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Progress</p>
          <p className="text-lg font-bold tabular-nums">{pct}%</p>
        </div>
      </div>

      {/* Progress bar */}
      {wo.stage_count > 0 && (
        <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden mb-4">
          <div
            className="h-full rounded-full bg-violet-500/60 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Top-level blockers (from work order packet) */}
      {mainBlockers.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {mainBlockers.map((b, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2">
              <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-300/90 leading-relaxed">{b.detail}</p>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/50">
        Created <RelativeTime date={wo.created_at} short /> · Last updated <RelativeTime date={wo.updated_at} short />
      </p>
    </div>
  );
}

// ── Work order top-level packet summary ───────────────────────────────────────

function WorkOrderPacketSummary({ wo }: { wo: WorkOrderSummary }) {
  const pkt = wo.intelligence_packet;
  if (!pkt) return null;
  const topFindings = packetAuditFindings(pkt);

  return (
    <div className="px-5 py-4 border-b border-white/[0.06]">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
        <Target className="h-3 w-3" /> Work Order Intelligence
      </p>
      <IntelligencePacketPanel packet={pkt} readinessState={wo.readiness_state} />
      {topFindings.length > 0 && (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide mb-2">
            <BarChart3 className="h-3 w-3" /> Key Audit Findings
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {topFindings.map((f, i) => (
              <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                <p className="text-[10px] text-muted-foreground">{f.label}</p>
                <p className={cn(
                  "text-sm font-semibold tabular-nums",
                  typeof f.value === "number" && f.value > 0 ? "text-amber-300" : "text-foreground",
                )}>
                  {f.value ?? "—"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Stage sequence ─────────────────────────────────────────────────────────────

function StageSequence({ wo }: { wo: WorkOrderSummary }) {
  const tasks = wo.stage_tasks;

  if (tasks.length === 0) {
    return (
      <div className="px-5 py-8 text-center">
        <ClipboardList className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No stage tasks linked to this work order.</p>
      </div>
    );
  }

  return (
    <div className="px-5 py-5">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-4 flex items-center gap-1.5">
        <ClipboardList className="h-3 w-3" /> Stage Sequence ({tasks.length} stage{tasks.length !== 1 ? "s" : ""})
      </p>
      <div>
        {tasks.map((task, i) => (
          <StageCard key={task.id} task={task} index={i} total={tasks.length} />
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function WorkOrderDetailPage() {
  const { id } = Route.useParams();
  const getFn = useServerFn(getWorkOrderDetail);
  const getReportFn = useServerFn(getGadsAnalysisReport);

  const { data: wo, isLoading, error, refetch } = useQuery({
    queryKey: ["work-order-detail", id],
    queryFn: () => getFn({ data: { id } }),
    staleTime: 30_000,
    throwOnError: false,
  });

  const { data: gadsReport } = useQuery({
    queryKey: ["work-order-gads-report", id],
    queryFn: () => getReportFn({ data: { workOrderId: id } }),
    staleTime: 30_000,
    throwOnError: false,
  });

  return (
    <HiveMindShell>
      {/* Back nav */}
      <div className="sticky top-0 z-20 border-b border-white/[0.07] bg-[hsl(var(--background))]/95 backdrop-blur-sm px-5 py-3 flex items-center gap-3">
        <Link
          to="/hivemind/tasks"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> HiveMind Tasks
        </Link>
        {wo && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
            <span className="text-xs text-foreground/70 truncate min-w-0">{wo.title}</span>
          </>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading work order…
        </div>
      ) : error ? (
        <div className="px-5 py-10 text-center">
          <AlertTriangle className="h-8 w-8 text-red-400/50 mx-auto mb-2" />
          <p className="text-sm text-red-300">Work order details could not be loaded.</p>
          <p className="text-xs text-muted-foreground mt-1">Work order ID: {id}</p>
          <p className="text-xs text-muted-foreground/70 mt-1">{(error as any)?.message ?? String(error)}</p>
          <button
            onClick={() => void refetch()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-all"
          >
            <Loader2 className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      ) : wo ? (
        <>
          <WorkOrderHeader wo={wo as WorkOrderSummary} />
          <WorkOrderPacketSummary wo={wo as WorkOrderSummary} />
          {gadsReport && (
            <div className="px-5 py-5 border-b border-white/[0.06]">
              <GadsAnalysisReportViewer report={gadsReport as any} />
            </div>
          )}
          <StageSequence wo={wo as WorkOrderSummary} />
        </>
      ) : (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-muted-foreground">Work order not found.</p>
        </div>
      )}
    </HiveMindShell>
  );
}
