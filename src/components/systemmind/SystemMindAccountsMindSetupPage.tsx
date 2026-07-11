import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Loader2, Sparkles, BarChart3, Pause, Play, EyeOff, Archive,
  Undo2, ShieldAlert, ArrowRight, LayoutDashboard, ListChecks, Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SystemMindShell } from "./SystemMindShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  generateAccountsMindConfigDraft,
  listAccountsMindConfig,
  computeAccountsMindMetrics,
  setConfigItemStatus,
  rollbackConfigItem,
  listAvailableMetrics,
} from "@/lib/accountsmind/accountsmind-config.functions";

const STATUS_COLORS: Record<string, string> = {
  active: "text-emerald-400 border-emerald-500/30",
  paused: "text-orange-400 border-orange-500/30",
  hidden: "text-muted-foreground border-white/10",
};

function formatMetric(value: number | null | undefined, format: string): string {
  if (value == null) return "—";
  switch (format) {
    case "currency":   return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    case "percentage": return `${value}%`;
    case "duration":   return `${value.toLocaleString()} min`;
    default:           return value.toLocaleString();
  }
}

function ConfigItemRow({
  kind, item, metricValue, busy, onStatus, onRollback,
}: {
  kind: "field" | "stat" | "widget";
  item: any;
  metricValue?: number | null;
  busy: boolean;
  onStatus: (kind: string, id: string, status: string) => void;
  onRollback: (kind: string, id: string) => void;
}) {
  const label = item.label ?? item.title;
  const key = item.field_key ?? item.stat_key ?? item.widget_key;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 flex-wrap">
      <Badge variant="outline" className="text-[10px] font-mono shrink-0">{key}</Badge>
      <span className="text-xs font-medium">{label}</span>
      {item.metric_key && (
        <span className="text-[10px] text-muted-foreground">
          {item.metric_key}
          {metricValue !== undefined && (
            <span className="ml-1 text-cyan-300 font-semibold">{formatMetric(metricValue, item.format)}</span>
          )}
        </span>
      )}
      {item.field_type && <span className="text-[10px] text-muted-foreground">{item.field_type} · {item.entity_type}</span>}
      <Badge variant="outline" className={cn("text-[9px]", STATUS_COLORS[item.status] ?? "text-muted-foreground border-white/10")}>
        {item.status}{item.version > 1 ? ` · v${item.version}` : ""}
      </Badge>
      {item.client_visible && (
        <Badge variant="outline" className="text-[9px] border-sky-500/30 text-sky-400"><Eye className="mr-0.5 h-2 w-2" />client</Badge>
      )}
      {item.risk_level === "high" && (
        <Badge variant="outline" className="text-[9px] border-red-500/30 text-red-400"><ShieldAlert className="mr-0.5 h-2 w-2" />sensitive</Badge>
      )}
      <div className="flex items-center gap-1 ml-auto">
        {item.status === "active" && (
          <>
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" disabled={busy} title="Pause" onClick={() => onStatus(kind, item.id, "paused")}>
              <Pause className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" disabled={busy} title="Hide" onClick={() => onStatus(kind, item.id, "hidden")}>
              <EyeOff className="h-3 w-3" />
            </Button>
          </>
        )}
        {(item.status === "paused" || item.status === "hidden") && (
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" disabled={busy} title="Reactivate" onClick={() => onStatus(kind, item.id, "active")}>
            <Play className="h-3 w-3" />
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" disabled={busy} title="Archive" onClick={() => onStatus(kind, item.id, "archived")}>
          <Archive className="h-3 w-3" />
        </Button>
        {item.previous_version_id && (
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" disabled={busy} title="Roll back to previous version" onClick={() => onRollback(kind, item.id)}>
            <Undo2 className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function SystemMindAccountsMindSetupPage() {
  const qc = useQueryClient();
  const [description, setDescription] = useState("");

  const generateFn  = useServerFn(generateAccountsMindConfigDraft);
  const listFn      = useServerFn(listAccountsMindConfig);
  const metricsFn   = useServerFn(computeAccountsMindMetrics);
  const statusFn    = useServerFn(setConfigItemStatus);
  const rollbackFn  = useServerFn(rollbackConfigItem);
  const metricsListFn = useServerFn(listAvailableMetrics);

  const { data: config, isLoading } = useQuery({
    queryKey: ["accountsmind-config"],
    queryFn: () => listFn({ data: { includeNonActive: true } }),
    throwOnError: false,
  });

  const { data: availableMetrics } = useQuery({
    queryKey: ["accountsmind-available-metrics"],
    queryFn: () => metricsListFn(),
    throwOnError: false,
    staleTime: 5 * 60_000,
  });

  const metricKeys = [
    ...(config?.stats ?? []).map((s: any) => s.metric_key),
    ...(config?.widgets ?? []).map((w: any) => w.metric_key),
  ].filter(Boolean);

  const { data: metricValues } = useQuery({
    queryKey: ["accountsmind-metric-values", [...new Set(metricKeys)].sort().join(",")],
    queryFn: () => metricsFn({ data: { keys: [...new Set(metricKeys)] } }),
    enabled: metricKeys.length > 0,
    throwOnError: false,
  });

  const generateMut = useMutation({
    mutationFn: () => generateFn({ data: { description } }),
    onSuccess: (res: any) => {
      toast.success(`Draft "${res.draft?.title ?? "config"}" created (${res.riskLevel} risk) — review it on the Automation page.`);
      setDescription("");
      qc.invalidateQueries({ queryKey: ["systemmind-automation-drafts"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Generation failed"),
  });

  const statusMut = useMutation({
    mutationFn: ({ kind, id, status }: { kind: string; id: string; status: string }) =>
      statusFn({ data: { kind: kind as any, id, status: status as any } }),
    onSuccess: () => { toast.success("Status updated"); qc.invalidateQueries({ queryKey: ["accountsmind-config"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Update failed"),
  });

  const rollbackMut = useMutation({
    mutationFn: ({ kind, id }: { kind: string; id: string }) =>
      rollbackFn({ data: { kind: kind as any, id } }),
    onSuccess: () => { toast.success("Rolled back to previous version"); qc.invalidateQueries({ queryKey: ["accountsmind-config"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Rollback failed"),
  });

  const busy = statusMut.isPending || rollbackMut.isPending;
  const onStatus = (kind: string, id: string, status: string) => statusMut.mutate({ kind, id, status });
  const onRollback = (kind: string, id: string) => rollbackMut.mutate({ kind, id });

  return (
    <SystemMindShell>
      <div className="p-5 md:p-6 max-w-4xl space-y-6">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <BarChart3 className="h-4.5 w-4.5 text-emerald-400" /> AccountsMind Setup
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Describe the dashboards, stats and custom fields this workspace needs — SystemMind drafts the
            configuration, and nothing goes live until a human approves it on the Automation page.
          </p>
        </div>

        {/* Generate */}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
          <p className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-400" /> Describe what you need
          </p>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder='e.g. "We are a solar installation company. We want a client dashboard showing this month&apos;s calls, booked meetings and qualified leads, plus an internal cost-per-call stat and a custom field for panel type on each client."'
            className="min-h-24 text-xs"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm" className="h-8 text-xs"
              disabled={generateMut.isPending || description.trim().length < 10}
              onClick={() => generateMut.mutate()}
            >
              {generateMut.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
              Draft configuration
            </Button>
            <Link to="/systemmind/automation" className="text-[11px] text-sky-400 hover:underline inline-flex items-center gap-1">
              Review &amp; approve drafts <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Stats and widgets can only use verified platform metrics — billing and cost metrics are never shown to clients.
          </p>
        </div>

        {/* Live config */}
        <div className="space-y-4">
          <p className="text-sm font-semibold flex items-center gap-2">
            <LayoutDashboard className="h-4 w-4 text-emerald-400" /> Live configuration
          </p>
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading configuration…
            </div>
          ) : (
            <>
              {(config?.fields?.length ?? 0) + (config?.stats?.length ?? 0) + (config?.widgets?.length ?? 0) === 0 && (
                <p className="text-xs text-muted-foreground rounded-lg border border-white/[0.05] bg-white/[0.02] p-4">
                  No configuration is live yet. Draft one above, then approve it on the Automation page.
                </p>
              )}
              {(config?.widgets?.length ?? 0) > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Dashboard widgets</p>
                  {config!.widgets.map((w: any) => (
                    <ConfigItemRow key={w.id} kind="widget" item={w} metricValue={metricValues?.[w.metric_key]} busy={busy} onStatus={onStatus} onRollback={onRollback} />
                  ))}
                </div>
              )}
              {(config?.stats?.length ?? 0) > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Stats</p>
                  {config!.stats.map((s: any) => (
                    <ConfigItemRow key={s.id} kind="stat" item={s} metricValue={metricValues?.[s.metric_key]} busy={busy} onStatus={onStatus} onRollback={onRollback} />
                  ))}
                </div>
              )}
              {(config?.fields?.length ?? 0) > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Custom fields</p>
                  {config!.fields.map((f: any) => (
                    <ConfigItemRow key={f.id} kind="field" item={f} busy={busy} onStatus={onStatus} onRollback={onRollback} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Available metrics */}
        {availableMetrics && availableMetrics.length > 0 && (
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
            <p className="text-sm font-semibold flex items-center gap-2 mb-2">
              <ListChecks className="h-4 w-4 text-emerald-400" /> Available metrics
            </p>
            <div className="space-y-1">
              {availableMetrics.map((m: any) => (
                <div key={m.key} className="flex items-center gap-2 text-[11px] flex-wrap">
                  <Badge variant="outline" className="text-[10px] font-mono">{m.key}</Badge>
                  <span className="text-muted-foreground">{m.description}</span>
                  {m.sensitive && (
                    <Badge variant="outline" className="text-[9px] border-red-500/30 text-red-400">internal only</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </SystemMindShell>
  );
}
