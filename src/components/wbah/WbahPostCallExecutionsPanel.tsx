/**
 * n8n-style execution history for WBAH post-call pipeline runs.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { N8nDataViewer } from "@/components/wbah/N8nDataViewer";
import {
  getWbahPostCallExecutionFn,
  getWbahPostCallQueueStatsFn,
  listWbahPostCallExecutionsFn,
  rerunWbahPostCallExecutionFn,
} from "@/lib/systemmind/wbah-workflow-wizard.functions";
import type { WbahExecutionDisplayStatus } from "@/lib/wbah/post-call/wbah-execution-status.shared";

type WbahExecutionDetail = {
  status: string;
  displayStatus: string;
  retellCallId: string | null;
  leadId: string | null;
  event: string;
  attemptCount: number;
  maxAttempts: number;
  createdAt: string;
  branches: string[];
  errors: string[];
  lastError: string | null;
  nodeSteps?: Array<{
    nodeId: string;
    nodeName: string;
    nodeType: string;
    status: string;
    branch: string | null;
    startedAt: string;
    completedAt: string | null;
    error: string | null;
    outputMasked?: Record<string, unknown>;
  }>;
};

type StatusFilter = "all" | "success" | "warning" | "failed" | "queued";

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "success", label: "Success" },
  { value: "warning", label: "Warnings" },
  { value: "failed", label: "Failed" },
  { value: "queued", label: "Queued" },
];

function statusBadge(displayStatus: WbahExecutionDisplayStatus) {
  if (displayStatus === "failed") {
    return (
      <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-600 dark:text-red-300">
        Failed
      </Badge>
    );
  }
  if (displayStatus === "warning") {
    return (
      <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-300">
        Warning
      </Badge>
    );
  }
  if (displayStatus === "success") {
    return (
      <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600 dark:text-emerald-300">
        Success
      </Badge>
    );
  }
  if (displayStatus === "running") {
    return (
      <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-300">
        Running
      </Badge>
    );
  }
  if (displayStatus === "retrying") {
    return (
      <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">
        Retrying
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] border-gray-600 text-gray-400">
      Queued
    </Badge>
  );
}

function fmtTime(iso: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function shortId(id: string | null) {
  if (!id) return "—";
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function stepStatusIcon(status: string) {
  if (status === "success") return <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />;
  if (status === "error") return <XCircle className="h-3 w-3 shrink-0 text-red-400" />;
  if (status === "waiting") return <Clock className="h-3 w-3 shrink-0 text-amber-400" />;
  if (status === "skipped") return <AlertCircle className="h-3 w-3 shrink-0 text-gray-500" />;
  return <Loader2 className="h-3 w-3 shrink-0 text-blue-400" />;
}

export function WbahPostCallExecutionsPanel() {
  const listFn = useServerFn(listWbahPostCallExecutionsFn);
  const detailFn = useServerFn(getWbahPostCallExecutionFn);
  const statsFn = useServerFn(getWbahPostCallQueueStatsFn);
  const rerunFn = useServerFn(rerunWbahPostCallExecutionFn);
  const qc = useQueryClient();

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedStepKey, setSelectedStepKey] = useState<string | null>(null);
  const [rerunId, setRerunId] = useState<string | null>(null);
  const [includeUnsafe, setIncludeUnsafe] = useState(false);
  const [rerunning, setRerunning] = useState<string | null>(null);

  const { data: stats } = useQuery({
    queryKey: ["wbah-queue-stats"],
    queryFn: () => statsFn(),
    refetchInterval: 15_000,
    throwOnError: false,
  });

  const {
    data: executions,
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["wbah-executions", filter],
    queryFn: () => listFn({ data: { status: filter, limit: 100 } } as any),
    refetchInterval: 15_000,
    throwOnError: false,
  });

  const runRerun = async (jobId: string, withUnsafe: boolean) => {
    setRerunning(jobId);
    try {
      const res = (await rerunFn({
        data: { jobId, includeUnsafeSteps: withUnsafe },
      } as any)) as { ok: boolean; errors: string[]; skippedSteps: string[] };

      // A rerun that "succeeds" can still carry per-step errors — the pipeline
      // collects them rather than throwing, so reporting only ok/not-ok would
      // call a half-failed replay a success.
      if (res.errors?.length) {
        toast.error(`Rerun finished with ${res.errors.length} error(s)`, {
          description: res.errors.slice(0, 2).join("; "),
        });
      } else {
        toast.success("Rerun complete", {
          description: res.skippedSteps?.length
            ? `Skipped: ${res.skippedSteps.join(", ")}`
            : "All steps replayed",
        });
      }
      qc.invalidateQueries({ queryKey: ["wbah-executions"] });
      qc.invalidateQueries({ queryKey: ["wbah-execution", jobId] });
      qc.invalidateQueries({ queryKey: ["wbah-queue-stats"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rerun failed");
    } finally {
      setRerunning(null);
      setRerunId(null);
      setIncludeUnsafe(false);
    }
  };

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["wbah-execution", selectedId],
    queryFn: () => detailFn({ data: { jobId: selectedId! } } as any) as Promise<WbahExecutionDetail>,
    enabled: !!selectedId,
    throwOnError: false,
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={filter === f.value ? "default" : "ghost"}
              className={cn(
                "h-7 text-[10px]",
                filter === f.value
                  ? "bg-gray-800 text-gray-100"
                  : "text-gray-500 hover:text-gray-300",
              )}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-[10px] text-gray-600">
          {stats && (
            <span>
              {stats.completed24h} today · {stats.failed} failed
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-gray-500"
            disabled={isFetching}
            onClick={() => refetch()}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-gray-800/80 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
            Loading…
          </div>
        ) : (executions ?? []).length === 0 ? (
          <div className="py-20 px-6 text-center">
            <p className="text-sm text-gray-400">No runs yet</p>
            <p className="text-[11px] text-gray-600 mt-1">
              Runs appear here after Retell webhooks are processed.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-gray-800/80 hover:bg-transparent">
                <TableHead className="text-[10px] text-gray-500 w-24">Status</TableHead>
                <TableHead className="text-[10px] text-gray-500">Call</TableHead>
                <TableHead className="text-[10px] text-gray-500">Event</TableHead>
                <TableHead className="text-[10px] text-gray-500 text-right">Time</TableHead>
                <TableHead className="text-[10px] text-gray-500 text-right w-16">Rerun</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(executions ?? []).map((ex) => (
                <TableRow
                  key={ex.id}
                  className="border-gray-800/80 cursor-pointer hover:bg-gray-900/50"
                  onClick={() => setSelectedId(ex.id)}
                >
                  <TableCell className="py-2.5">{statusBadge(ex.displayStatus as WbahExecutionDisplayStatus)}</TableCell>
                  <TableCell className="py-2.5 font-mono text-[10px] text-gray-400">
                    {shortId(ex.retellCallId)}
                  </TableCell>
                  <TableCell className="py-2.5 text-[11px] text-gray-300">{ex.event}</TableCell>
                  <TableCell className="py-2.5 text-[10px] text-gray-500 text-right whitespace-nowrap">
                    {fmtTime(ex.createdAt)}
                  </TableCell>
                  <TableCell className="py-2.5 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-gray-400 hover:text-gray-100"
                      title="Replay this execution"
                      aria-label={`Rerun execution ${shortId(ex.retellCallId)}`}
                      disabled={rerunning === ex.id}
                      onClick={(e) => {
                        // The row itself opens the detail sheet.
                        e.stopPropagation();
                        setIncludeUnsafe(false);
                        setRerunId(ex.id);
                      }}
                    >
                      {rerunning === ex.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Sheet open={!!selectedId} onOpenChange={(open) => {
        if (!open) {
          setSelectedId(null);
          setSelectedStepKey(null);
        }
      }}>
        <SheetContent side="right" className="w-full sm:max-w-lg bg-gray-950 border-gray-800 overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-sm text-gray-100">Run details</SheetTitle>
          </SheetHeader>
          {selectedId && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 h-7 w-full text-[11px]"
              disabled={rerunning === selectedId}
              onClick={() => {
                setIncludeUnsafe(false);
                setRerunId(selectedId);
              }}
            >
              {rerunning === selectedId ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <RotateCcw className="mr-1.5 h-3 w-3" />
              )}
              Rerun this execution
            </Button>
          )}
          {detailLoading || !detail ? (
            <div className="flex items-center gap-2 py-8 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="mt-4 space-y-4 text-[11px]">
              <div>{statusBadge(detail.displayStatus as WbahExecutionDisplayStatus)}</div>

              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-gray-400">
                <dt>Call</dt>
                <dd className="font-mono text-gray-300 break-all">{detail.retellCallId ?? "—"}</dd>
                <dt>Lead</dt>
                <dd className="font-mono text-gray-300">{detail.leadId ?? "—"}</dd>
                <dt>Event</dt>
                <dd className="text-gray-300">{detail.event}</dd>
                <dt>Attempts</dt>
                <dd className="text-gray-300">
                  {detail.attemptCount} / {detail.maxAttempts}
                </dd>
                <dt>Started</dt>
                <dd>{fmtTime(detail.createdAt)}</dd>
              </dl>

              {detail.branches.length > 0 && (
                <div>
                  <p className="text-gray-500 mb-1.5">Pipeline branches</p>
                  <ul className="space-y-1">
                    {detail.branches.map((b) => (
                      <li key={b} className="flex items-center gap-1.5 text-emerald-300/90">
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {detail.nodeSteps && detail.nodeSteps.length > 0 && (
                <div>
                  <p className="text-gray-500 mb-1.5">
                    Node timeline ({detail.nodeSteps.length})
                  </p>
                  <ul className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {detail.nodeSteps.map((step) => {
                      const key = `${step.nodeId}-${step.startedAt}`;
                      const selected = selectedStepKey === key;
                      return (
                        <li key={key}>
                          <button
                            type="button"
                            onClick={() => setSelectedStepKey(selected ? null : key)}
                            className={cn(
                              "w-full flex items-start gap-1.5 rounded border px-2 py-1.5 text-left transition-colors",
                              selected
                                ? "border-violet-500/50 bg-violet-500/10"
                                : "border-gray-800/60 bg-gray-900/40 hover:border-gray-700",
                            )}
                          >
                            {stepStatusIcon(step.status)}
                            <div className="min-w-0 flex-1">
                              <p className="text-gray-200 truncate">{step.nodeName || step.nodeId}</p>
                              <p className="text-[9px] text-gray-600 font-mono truncate">
                                {step.nodeType}
                                {step.branch ? ` · ${step.branch}` : ""}
                              </p>
                              {step.error && (
                                <p className="text-[9px] text-red-300/90 mt-0.5 leading-snug">{step.error}</p>
                              )}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {selectedStepKey && (() => {
                    const step = detail.nodeSteps!.find(
                      (s) => `${s.nodeId}-${s.startedAt}` === selectedStepKey,
                    );
                    if (!step) return null;
                    return (
                      <div className="mt-3 rounded-lg border border-gray-800 bg-gray-900/50 p-3 space-y-3">
                        <p className="text-xs font-medium text-gray-200">
                          {step.nodeName || step.nodeId}
                        </p>
                        <div className="text-[10px] text-gray-500">
                          Status: {step.status}
                          {step.completedAt
                            ? ` · ${fmtTime(step.completedAt)}`
                            : step.startedAt
                              ? ` · started ${fmtTime(step.startedAt)}`
                              : ""}
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-500 mb-1.5">Output</p>
                          <N8nDataViewer
                            data={step.outputMasked}
                            emptyLabel="No output recorded for this step."
                            maxHeight="max-h-72"
                          />
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {(detail.errors.length > 0 || detail.lastError) && (
                <div
                  className={cn(
                    "rounded-md border p-3 space-y-1.5",
                    detail.displayStatus === "warning" || detail.displayStatus === "retrying"
                      ? "border-amber-500/25 bg-amber-500/5"
                      : "border-red-500/25 bg-red-500/5",
                  )}
                >
                  <p
                    className={cn(
                      "font-medium flex items-center gap-1 text-xs",
                      detail.displayStatus === "warning" || detail.displayStatus === "retrying"
                        ? "text-amber-300"
                        : "text-red-300",
                    )}
                  >
                    {detail.displayStatus === "warning" ? (
                      <>
                        <AlertCircle className="h-3.5 w-3.5" /> Step errors (partial run)
                      </>
                    ) : detail.displayStatus === "retrying" ? (
                      <>
                        <AlertCircle className="h-3.5 w-3.5" /> Last attempt failed (retry scheduled)
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3.5 w-3.5" /> What failed
                      </>
                    )}
                  </p>
                  {(detail.lastError ? [detail.lastError, ...detail.errors] : detail.errors)
                    .filter(Boolean)
                    .slice(0, 5)
                    .map((err, i) => (
                      <p
                        key={i}
                        className={cn(
                          "text-[10px] leading-relaxed",
                          detail.displayStatus === "warning" || detail.displayStatus === "retrying"
                            ? "text-amber-200/90"
                            : "text-red-200/90",
                        )}
                      >
                        {err}
                      </p>
                    ))}
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* A rerun writes to Dynamics for real, so it asks first. The Calendly
          opt-in is off by default and stays a deliberate choice: that step
          books an actual appointment and is not idempotent. */}
      <AlertDialog
        open={!!rerunId}
        onOpenChange={(open) => {
          if (!open && !rerunning) {
            setRerunId(null);
            setIncludeUnsafe(false);
          }
        }}
      >
        <AlertDialogContent className="bg-gray-950 border-gray-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm text-gray-100">
              Rerun this execution?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[11px] leading-relaxed text-gray-400">
              The original webhook payload is replayed through the pipeline as it exists now, so
              this is how a call from before a fix picks the fix up. It writes for real: Dynamics
              field updates, the timeline note and the dashboard post all happen again.
              <br />
              <br />
              Held back by default: <span className="text-gray-300">calendly_invitee</span>, which
              would book the customer a second appointment, and{" "}
              <span className="text-gray-300">live_transcript</span>, which only means anything
              during a live call.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <label className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/5 p-2.5">
            <Checkbox
              checked={includeUnsafe}
              onCheckedChange={(v) => setIncludeUnsafe(v === true)}
              className="mt-0.5"
            />
            <span className="text-[11px] leading-relaxed text-amber-200/90">
              Also replay the held-back steps — this can create a duplicate Calendly booking. Only
              use it when the original run failed before reaching them.
            </span>
          </label>

          <AlertDialogFooter>
            <AlertDialogCancel className="h-7 text-[11px]" disabled={!!rerunning}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-7 text-[11px]"
              disabled={!!rerunning}
              onClick={(e) => {
                // Keep the dialog up while the run is in flight; runRerun
                // closes it when the result is known.
                e.preventDefault();
                if (rerunId) void runRerun(rerunId, includeUnsafe);
              }}
            >
              {rerunning ? (
                <>
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Running…
                </>
              ) : (
                "Rerun"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
