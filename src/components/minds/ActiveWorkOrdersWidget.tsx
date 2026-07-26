/**
 * ActiveWorkOrdersWidget — compact work order summary for embedding in Mind
 * overview dashboards (GrowthMind, SystemMind, AccountsMind, HiveMind).
 *
 * Filters to work orders assigned to the given mind(s). Pass `minds={null}`
 * to show all workspace work orders.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  GitBranch, AlertTriangle, ShieldCheck, ChevronRight, Loader2,
  CheckCircle2, Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/ui/relative-time";
import {
  getWorkOrders,
  workOrderStatusLabel,
  workOrderProgressPct,
  type WorkOrderSummary,
} from "@/lib/hivemind/work-orders-query.server";

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

function MiniWorkOrderRow({ wo }: { wo: WorkOrderSummary }) {
  const pct = workOrderProgressPct(wo);
  const label = workOrderStatusLabel(wo.status);
  const style = WO_STATUS_STYLES[wo.status] ?? "bg-white/[0.05] text-muted-foreground border-white/[0.1]";
  const hasBlockers = wo.blocker_count > 0;
  const awaitingApproval = wo.stage_tasks.filter(
    (t) => t.readiness_state &&
      ["ready_for_analysis_approval","ready_for_content_approval",
       "ready_for_change_approval","ready_for_publication_approval","ready_for_execution"].includes(t.readiness_state) &&
      t.status !== "completed"
  ).length;
  const blockedStages = wo.stage_tasks.filter(
    (t) => (t.readiness_state === "blocked" || t.readiness_state === "integration_required") &&
      t.status !== "completed"
  ).length;

  return (
    <Link
      to="/hivemind/work-orders/$id"
      params={{ id: wo.id }}
      className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.015] transition-colors group"
    >
      <div className={cn(
        "h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
        hasBlockers ? "bg-red-500/10" : "bg-violet-500/10",
      )}>
        <GitBranch className={cn("h-3.5 w-3.5", hasBlockers ? "text-red-400" : "text-violet-400")} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
          <span className={cn("text-[10px] rounded-full px-1.5 py-0.5 border font-medium", style)}>
            {label}
          </span>
          {wo.channel_kind && (
            <span className="text-[10px] text-muted-foreground/50 capitalize">
              {wo.channel_kind.replace(/_/g, " ")}
            </span>
          )}
        </div>
        <p className="text-xs font-medium truncate group-hover:text-violet-300 transition-colors">{wo.title}</p>
        <div className="flex items-center gap-2.5 mt-1 flex-wrap">
          {wo.stage_count > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="h-1 w-14 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full bg-violet-500/50"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground/50 tabular-nums">{pct}%</span>
            </div>
          )}
          {blockedStages > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-red-400">
              <Ban className="h-2.5 w-2.5" />{blockedStages} blocked
            </span>
          )}
          {awaitingApproval > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-violet-400">
              <ShieldCheck className="h-2.5 w-2.5" />{awaitingApproval} need{awaitingApproval === 1 ? "s" : ""} approval
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/40">
            <RelativeTime date={wo.updated_at} short />
          </span>
        </div>
      </div>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground shrink-0 mt-1.5 transition-colors" />
    </Link>
  );
}

export interface ActiveWorkOrdersWidgetProps {
  /** Filter to work orders whose assigned_minds includes any of these. Pass null to show all. */
  minds?: string[] | null;
  /** Maximum rows to show before "View all →" */
  maxRows?: number;
  /** Panel title */
  title?: string;
  /** "View all" link — defaults to /hivemind/work-orders */
  viewAllHref?: string;
  /** Extra className on the outer wrapper */
  className?: string;
}

export function ActiveWorkOrdersWidget({
  minds = null,
  maxRows = 4,
  title = "Active Work Orders",
  viewAllHref = "/hivemind/work-orders",
  className,
}: ActiveWorkOrdersWidgetProps) {
  const getWoFn = useServerFn(getWorkOrders);

  const { data, isLoading } = useQuery({
    queryKey: ["active-work-orders-widget"],
    queryFn: () => getWoFn(),
    staleTime: 60_000,
    throwOnError: false,
  });

  const allWOs = (data ?? []) as WorkOrderSummary[];

  const active = allWOs
    .filter((wo) => !["completed", "cancelled"].includes(wo.status))
    .filter((wo) => {
      if (!minds) return true;
      return wo.assigned_minds.some((m) => minds.includes(m));
    });

  if (!isLoading && active.length === 0) return null;

  const shown = active.slice(0, maxRows);
  const rest = active.length - shown.length;

  return (
    <div className={cn("rounded-xl border border-white/[0.06] bg-card/40 overflow-hidden", className)}>
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-violet-400" />
          <p className="text-sm font-semibold">{title}</p>
          {!isLoading && active.length > 0 && (
            <span className="rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-violet-400 leading-none">
              {active.length}
            </span>
          )}
        </div>
        <Link
          to={viewAllHref as any}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          View all →
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 px-4 py-4 text-muted-foreground/60 text-xs">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="divide-y divide-white/[0.04]">
          {shown.map((wo) => (
            <MiniWorkOrderRow key={wo.id} wo={wo} />
          ))}
          {rest > 0 && (
            <Link
              to={viewAllHref as any}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              +{rest} more work order{rest !== 1 ? "s" : ""}
              <ChevronRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
