/**
 * Work Orders list page — shows all work orders for the workspace, grouped
 * by status, with stage progress and audit-finding highlights.
 *
 * Linked from the HiveMind sidebar nav (assistant + operator modes).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  GitBranch, AlertTriangle, CheckCircle2, Clock, Loader2,
  ShieldCheck, ChevronRight, BarChart3, Ban, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HiveMindShell } from "@/components/hivemind/HiveMindShell";
import { RelativeTime } from "@/components/ui/relative-time";
import { ReadinessBadge } from "@/components/minds/IntelligencePacketPanel";
import {
  getWorkOrders,
  workOrderStatusLabel,
  workOrderProgressPct,
  packetAuditFindings,
  type WorkOrderSummary,
} from "@/lib/hivemind/work-orders-query.server";

export const Route = createFileRoute("/_authenticated/hivemind/work-orders")({
  head: () => ({ meta: [{ title: "Work Orders — Webee" }] }),
  component: WorkOrdersPage,
});

// ── Status config ─────────────────────────────────────────────────────────────

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

const STATUS_GROUPS = [
  { key: "active",    label: "Active",    statuses: ["open","in_progress","awaiting_approval","blocked","partially_completed","failed"] },
  { key: "done",      label: "Completed", statuses: ["completed","cancelled"] },
];

// ── Work order card ───────────────────────────────────────────────────────────

function WorkOrderCard({ wo }: { wo: WorkOrderSummary }) {
  const pct = workOrderProgressPct(wo);
  const label = workOrderStatusLabel(wo.status);
  const style = WO_STATUS_STYLES[wo.status] ?? "bg-white/[0.05] text-muted-foreground border-white/[0.1]";
  const hasBlockers = wo.blocker_count > 0;

  const topFindings = packetAuditFindings(wo.intelligence_packet).slice(0, 4);

  const approvableStages = wo.stage_tasks.filter(
    (t) => t.readiness_state &&
      ["ready_for_analysis_approval","ready_for_content_approval",
       "ready_for_change_approval","ready_for_publication_approval","ready_for_execution"].includes(t.readiness_state) &&
      t.status !== "completed"
  );

  const blockedStages = wo.stage_tasks.filter(
    (t) => (t.readiness_state === "blocked" || t.readiness_state === "integration_required") &&
      t.status !== "completed"
  );

  return (
    <div className={cn(
      "rounded-xl border transition-all",
      wo.status === "completed" || wo.status === "cancelled"
        ? "border-white/[0.05] bg-white/[0.01] opacity-70"
        : hasBlockers
        ? "border-red-500/15 bg-[hsl(var(--card))]"
        : "border-white/[0.08] bg-[hsl(var(--card))]",
    )}>
      <div className="px-4 py-4">
        {/* Header row */}
        <div className="flex items-start gap-3 mb-3">
          <div className={cn(
            "h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
            hasBlockers ? "bg-red-500/10 ring-1 ring-red-500/20" : "bg-violet-500/10 ring-1 ring-violet-500/20",
          )}>
            <GitBranch className={cn("h-4.5 w-4.5", hasBlockers ? "text-red-400" : "text-violet-400")} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={cn("text-[10px] rounded-full px-1.5 py-0.5 border font-medium", style)}>
                {label}
              </span>
              {wo.channel_kind && (
                <span className="text-[10px] text-muted-foreground/60 bg-white/[0.04] rounded-full px-1.5 py-0.5 capitalize">
                  {wo.channel_kind.replace(/_/g, " ")}
                </span>
              )}
              {wo.assigned_minds.map((m) => (
                <span key={m} className="text-[10px] text-muted-foreground/50 capitalize">{m}</span>
              ))}
            </div>
            <p className="text-sm font-semibold">{wo.title}</p>
            {wo.objective && (
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">{wo.objective}</p>
            )}
          </div>
          <Link
            to="/hivemind/work-orders/$id"
            params={{ id: wo.id }}
            aria-label={`View details for work order: ${wo.title}`}
            className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-violet-500/30 transition-all shrink-0"
          >
            Details
            <ChevronRight className="h-3 w-3" />
          </Link>
        </div>

        {/* Stage progress */}
        {wo.stage_count > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-muted-foreground">
                {wo.completed_stages}/{wo.stage_count} stage{wo.stage_count !== 1 ? "s" : ""} complete
              </span>
              <span className="text-[10px] text-muted-foreground">{pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all",
                  wo.status === "completed" ? "bg-emerald-500/60" : "bg-violet-500/50")}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Stage status chips */}
        {wo.stage_tasks.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {wo.stage_tasks.map((t, i) => {
              const stageLabel = (t.metadata as any)?.approval_stage_label ?? `Stage ${i + 1}`;
              return (
                <span key={t.id} className={cn(
                  "text-[10px] rounded-full px-2 py-0.5 border font-medium",
                  t.status === "completed"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : t.readiness_state === "blocked" || t.readiness_state === "integration_required"
                    ? "bg-red-500/10 text-red-400 border-red-500/20"
                    : t.readiness_state && ["ready_for_analysis_approval","ready_for_content_approval","ready_for_change_approval","ready_for_publication_approval","ready_for_execution"].includes(t.readiness_state)
                    ? "bg-violet-500/10 text-violet-400 border-violet-500/20"
                    : "bg-white/[0.04] text-muted-foreground border-white/[0.06]",
                )}>
                  {stageLabel}
                </span>
              );
            })}
          </div>
        )}

        {/* Alerts */}
        {blockedStages.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.05] px-3 py-2 mb-3">
            <Ban className="h-3 w-3 text-red-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-300/90">
              {blockedStages.length} stage{blockedStages.length !== 1 ? "s" : ""} blocked
              {blockedStages[0].readiness_state === "integration_required" ? " — integration required" : ""}
            </p>
          </div>
        )}
        {approvableStages.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-violet-500/20 bg-violet-500/[0.05] px-3 py-2 mb-3">
            <ShieldCheck className="h-3 w-3 text-violet-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-violet-300/90">
              {approvableStages.length} stage{approvableStages.length !== 1 ? "s" : ""} awaiting approval —{" "}
              <Link to="/hivemind/tasks" className="underline underline-offset-2 hover:text-violet-300 transition-colors">
                review in Tasks
              </Link>
            </p>
          </div>
        )}

        {/* Audit findings grid */}
        {topFindings.length > 0 && (
          <div>
            <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide mb-2">
              <BarChart3 className="h-3 w-3" /> Key Findings
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {topFindings.map((f, i) => (
                <div key={i} className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
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

        <p className="text-[10px] text-muted-foreground/40 mt-3 text-right">
          Created <RelativeTime date={wo.created_at} short /> · Updated <RelativeTime date={wo.updated_at} short />
        </p>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function WorkOrdersPage() {
  const getWoFn = useServerFn(getWorkOrders);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["hivemind-work-orders"],
    queryFn: () => getWoFn(),
    staleTime: 30_000,
    throwOnError: false,
  });

  const allWOs = (data ?? []) as WorkOrderSummary[];

  const grouped = STATUS_GROUPS.map((g) => ({
    ...g,
    items: allWOs.filter((wo) => g.statuses.includes(wo.status)),
  }));

  const activeCount = grouped.find((g) => g.key === "active")?.items.length ?? 0;
  const blockerCount = allWOs.filter((wo) => wo.blocker_count > 0 && !["completed","cancelled"].includes(wo.status)).length;
  const awaitingCount = allWOs.filter((wo) =>
    !["completed","cancelled"].includes(wo.status) &&
    wo.stage_tasks.some((t) =>
      t.readiness_state &&
      ["ready_for_analysis_approval","ready_for_content_approval",
       "ready_for_change_approval","ready_for_publication_approval","ready_for_execution"].includes(t.readiness_state) &&
      t.status !== "completed"
    )
  ).length;

  return (
    <HiveMindShell>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-white/[0.07] bg-[hsl(var(--background))]/95 backdrop-blur-sm px-5 py-3 flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 ring-1 ring-violet-500/30 shrink-0">
          <GitBranch className="h-4 w-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Work Orders</p>
          <p className="text-[11px] text-muted-foreground">
            {activeCount} active · {blockerCount} blocked · {awaitingCount} awaiting approval
          </p>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isLoading}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-all disabled:opacity-40"
        >
          {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </div>

      {/* Summary chips */}
      {!isLoading && allWOs.length > 0 && (
        <div className="px-5 pt-4 flex flex-wrap gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-sky-500/20 bg-sky-500/[0.06] px-3 py-2">
            <GitBranch className="h-3 w-3 text-sky-400" />
            <span className="text-[11px] text-sky-300 font-medium">{activeCount} active work order{activeCount !== 1 ? "s" : ""}</span>
          </div>
          {blockerCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2">
              <AlertTriangle className="h-3 w-3 text-red-400" />
              <span className="text-[11px] text-red-300 font-medium">{blockerCount} with blockers</span>
            </div>
          )}
          {awaitingCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-violet-500/20 bg-violet-500/[0.06] px-3 py-2">
              <ShieldCheck className="h-3 w-3 text-violet-400" />
              <span className="text-[11px] text-violet-300 font-medium">{awaitingCount} awaiting approval</span>
            </div>
          )}
        </div>
      )}

      {/* Body */}
      <div className="px-5 py-5 space-y-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading work orders…
          </div>
        ) : allWOs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-12 w-12 rounded-full bg-violet-500/10 flex items-center justify-center mb-3">
              <GitBranch className="h-5 w-5 text-violet-400" />
            </div>
            <p className="text-sm font-medium">No work orders yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Work orders are created when you ask the HiveMind Assistant to run a channel campaign,
              pipeline review, or cross-channel strategy.
            </p>
            <Link
              to="/hivemind/chat"
              className="mt-4 flex items-center gap-1.5 rounded-lg bg-violet-500/15 border border-violet-500/30 px-4 py-2 text-xs font-medium text-violet-400 hover:bg-violet-500/25 transition-all"
            >
              <Zap className="h-3.5 w-3.5" />
              Open HiveMind Assistant
            </Link>
          </div>
        ) : (
          grouped.map((group) => {
            if (!group.items.length) return null;
            return (
              <div key={group.key}>
                <div className="flex items-center gap-2 mb-4">
                  {group.key === "active"
                    ? <Clock className="h-4 w-4 text-amber-400" />
                    : <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                  <span className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    {group.label}
                  </span>
                  <span className={cn(
                    "rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none",
                    group.key === "active"
                      ? "bg-amber-500/20 text-amber-400"
                      : "bg-emerald-500/20 text-emerald-400",
                  )}>
                    {group.items.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {group.items.map((wo) => (
                    <WorkOrderCard key={wo.id} wo={wo} />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </HiveMindShell>
  );
}
