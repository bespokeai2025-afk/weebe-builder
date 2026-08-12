import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Loader2, Target, RefreshCw, AlertTriangle, Info, Flame, ChevronDown,
  ChevronUp, X, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HiveMindShell } from "@/components/hivemind/HiveMindShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  listMarketingObjectives, getMarketingObjectiveStatus,
  setMarketingOperatorEnabled, setMarketingObjectiveStatus, dismissOperatorFinding,
} from "@/lib/hivemind/marketing-objectives.server";

export const Route = createFileRoute("/_authenticated/hivemind/marketing-operator")({
  head: () => ({ meta: [{ title: "Marketing Operator — HiveMind" }] }),
  component: MarketingOperatorPage,
});

const SEVERITY_META: Record<string, { icon: React.ElementType; cls: string }> = {
  critical:  { icon: Flame,         cls: "text-red-400 bg-red-500/10 border-red-500/30" },
  attention: { icon: AlertTriangle, cls: "text-amber-400 bg-amber-500/10 border-amber-500/30" },
  info:      { icon: Info,          cls: "text-sky-400 bg-sky-500/10 border-sky-500/30" },
};

const STATUS_CLS: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400",
  paused: "bg-slate-500/15 text-slate-400",
  achieved: "bg-violet-500/15 text-violet-400",
  not_achieved: "bg-red-500/15 text-red-400",
  abandoned: "bg-slate-600/15 text-slate-500",
};

function MarketingOperatorPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listMarketingObjectives);
  const toggleFn = useServerFn(setMarketingOperatorEnabled);
  const dismissFn = useServerFn(dismissOperatorFinding);
  const setStatusFn = useServerFn(setMarketingObjectiveStatus);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["marketing-operator"],
    queryFn: () => listFn(),
    staleTime: 30_000,
    throwOnError: false,
  });
  const [toggling, setToggling] = useState(false);

  const objectives = data?.objectives ?? [];
  const findings = data?.findings ?? [];

  return (
    <HiveMindShell>
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
              <Target className="h-5 w-5 text-violet-400" /> Marketing Operator
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Daily checks on your marketing data, measurable objectives, and honest before/after results.
              All changes stay approval-first unless you run autopilot.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
            </Button>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Daily check
              <Switch
                checked={data?.operatorEnabled === true}
                disabled={toggling || isLoading}
                onCheckedChange={async (v) => {
                  setToggling(true);
                  try {
                    await toggleFn({ data: { enabled: v } });
                    toast.success(v ? "Daily marketing check enabled" : "Daily marketing check disabled");
                    qc.invalidateQueries({ queryKey: ["marketing-operator"] });
                  } catch (e: any) {
                    toast.error(e?.message ?? "Failed to update");
                  } finally { setToggling(false); }
                }}
              />
            </label>
          </div>
        </div>

        {data?.operatorLastRunAt && (
          <p className="text-xs text-muted-foreground">
            Last daily check: {new Date(data.operatorLastRunAt).toLocaleString()}
          </p>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Findings */}
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Findings ({findings.length})
              </h2>
              {findings.length === 0 && (
                <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                  No open findings. New findings appear after each daily check when there is enough data to be sure (never single-day reactions).
                </p>
              )}
              {findings.map((f: any) => {
                const meta = SEVERITY_META[f.severity] ?? SEVERITY_META.info;
                const Icon = meta.icon;
                return (
                  <div key={f.id} className={cn("flex items-start gap-3 rounded-lg border p-3", meta.cls)}>
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{f.title}</p>
                      {f.detail && <p className="mt-0.5 text-xs text-muted-foreground">{f.detail}</p>}
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {f.finding_kind} · {f.run_date} · {f.status}
                      </p>
                    </div>
                    {f.status === "open" && (
                      <button
                        className="rounded p-1 text-muted-foreground hover:text-foreground"
                        title="Dismiss"
                        onClick={async () => {
                          try {
                            await dismissFn({ data: { findingId: f.id } });
                            qc.invalidateQueries({ queryKey: ["marketing-operator"] });
                          } catch (e: any) { toast.error(e?.message ?? "Failed"); }
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </section>

            {/* Objectives */}
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Objectives ({objectives.length})
              </h2>
              {objectives.length === 0 && (
                <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                  No objectives yet. Ask the HiveMind Assistant, e.g. “Improve my Google Ads performance”
                  or “Get me more demo bookings” — it will set a measurable objective with a real baseline.
                </p>
              )}
              {objectives.map((o: any) => (
                <ObjectiveCard
                  key={o.id}
                  objective={o}
                  onStatusChange={async (status) => {
                    try {
                      await setStatusFn({ data: { objectiveId: o.id, status } });
                      qc.invalidateQueries({ queryKey: ["marketing-operator"] });
                    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
                  }}
                />
              ))}
            </section>
          </>
        )}
      </div>
    </HiveMindShell>
  );
}

const SECTION_ORDER: Array<{ key: string; label: string }> = [
  { key: "currentPerformance", label: "Current performance" },
  { key: "diagnosis", label: "Diagnosis" },
  { key: "actionsTaken", label: "Actions taken" },
  { key: "actionsAwaitingApproval", label: "Actions awaiting approval" },
  { key: "results", label: "Results" },
  { key: "nextActions", label: "Next actions" },
];

function ObjectiveCard({ objective, onStatusChange }: {
  objective: any;
  onStatusChange: (status: "active" | "paused" | "achieved" | "not_achieved" | "abandoned") => void;
}) {
  const [open, setOpen] = useState(false);
  const statusFn = useServerFn(getMarketingObjectiveStatus);
  const { data: view, isLoading } = useQuery({
    queryKey: ["marketing-objective-status", objective.id],
    queryFn: () => statusFn({ data: { objectiveId: objective.id } }),
    enabled: open,
    staleTime: 60_000,
    throwOnError: false,
  });

  const baseline = objective.baseline ?? {};
  return (
    <div className="rounded-lg border border-border bg-card">
      <button className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setOpen((v) => !v)}>
        <Zap className="h-4 w-4 shrink-0 text-violet-400" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{objective.title}</p>
          <p className="text-xs text-muted-foreground">
            {objective.metric} · baseline {baseline.adequate === false ? "not measurable yet" : String(baseline.value ?? "—")}
            {objective.target?.pct ? ` · target ${objective.target.direction} ${objective.target.pct}%` : ""}
          </p>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", STATUS_CLS[objective.status] ?? STATUS_CLS.paused)}>
          {objective.status}
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="space-y-3 border-t border-border p-3">
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {view && SECTION_ORDER.map(({ key, label }) => {
            const v: any = (view as any)[key];
            return (
              <div key={key}>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                <SectionBody value={v} />
              </div>
            );
          })}
          <div className="flex gap-2 pt-1">
            {objective.status === "active" ? (
              <Button size="sm" variant="outline" onClick={() => onStatusChange("paused")}>Pause</Button>
            ) : objective.status === "paused" ? (
              <Button size="sm" variant="outline" onClick={() => onStatusChange("active")}>Resume</Button>
            ) : null}
            {["active", "paused"].includes(objective.status) && (
              <>
                <Button size="sm" variant="outline" onClick={() => onStatusChange("achieved")}>Mark achieved</Button>
                <Button size="sm" variant="ghost" onClick={() => onStatusChange("abandoned")}>Abandon</Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionBody({ value }: { value: any }) {
  if (value == null) return <p className="text-xs text-muted-foreground">—</p>;
  if (Array.isArray(value)) {
    if (!value.length) return <p className="text-xs text-muted-foreground">None</p>;
    return (
      <ul className="mt-1 space-y-1">
        {value.map((item, i) => (
          <li key={i} className="rounded bg-muted/40 px-2 py-1 text-xs text-foreground">
            {typeof item === "string" ? item :
              `${item.action_type ?? item.title ?? "item"}${item.platform ? ` (${item.platform})` : ""}${item.status ? ` — ${item.status}` : ""}${item.outcome_classification ? ` — outcome: ${item.outcome_classification}` : ""}`}
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") {
    if ("deltaPct" in value || "baseline" in value) {
      const cur = value.current ?? {};
      return (
        <p className="text-xs text-foreground">
          Current: {cur.adequate === false ? "not enough data yet" : String(cur.value ?? "—")}
          {value.deltaPct != null && ` · ${value.deltaPct > 0 ? "+" : ""}${value.deltaPct}% vs baseline`}
          {value.movingRightWay != null && (value.movingRightWay ? " · moving the right way" : " · not improving yet")}
        </p>
      );
    }
    if ("note" in value) {
      const counts = Object.entries(value.classifiedOutcomes ?? {}).map(([k, v]) => `${v}× ${k}`).join(", ");
      return (
        <p className="text-xs text-foreground">
          {counts || "No classified outcomes yet"}{value.measuring ? ` · ${value.measuring} measuring` : ""}
          <span className="block text-muted-foreground">{value.note}</span>
        </p>
      );
    }
    return <pre className="mt-1 overflow-x-auto rounded bg-muted/40 p-2 text-[10px] text-muted-foreground">{JSON.stringify(value, null, 1)}</pre>;
  }
  return <p className="text-xs text-foreground">{String(value)}</p>;
}
