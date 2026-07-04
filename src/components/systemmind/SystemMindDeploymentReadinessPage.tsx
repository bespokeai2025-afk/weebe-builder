import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Gauge, Loader2, RefreshCw, Sliders, ShieldCheck, CheckCircle2, Boxes, Cpu,
  TrendingUp, AlertTriangle, ChevronDown, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  getReadinessDashboardFn, listTemplateConfidenceFn, scoreTemplatesFn,
  getIntelligenceSettingsFn, updateIntelligenceSettingsFn,
} from "@/lib/systemmind/intelligence.functions";
import type { TemplateConfidenceRow } from "@/lib/systemmind/confidence-engine.server";
import { SystemMindShell } from "./SystemMindShell";
import {
  Chip, Section, RiskPill, ScoreBar, StatCard, MigrationNotice, ExecutionBanner, EmptyState,
} from "./intelligence/shared";

const DIMENSIONS: Array<{ key: keyof TemplateConfidenceRow; label: string }> = [
  { key: "understanding", label: "Understanding" },
  { key: "documentation", label: "Documentation" },
  { key: "reuse", label: "Reuse" },
  { key: "crm_portability", label: "CRM portability" },
  { key: "deployment_readiness", label: "Deployment readiness" },
  { key: "dependency", label: "Dependency" },
];

function ThresholdControl() {
  const qc = useQueryClient();
  const getFn = useServerFn(getIntelligenceSettingsFn);
  const updateFn = useServerFn(updateIntelligenceSettingsFn);
  const { data } = useQuery({ queryKey: ["systemmind-intel-settings"], queryFn: () => getFn(), throwOnError: false });
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? data?.confidence_threshold ?? 70;

  const mut = useMutation({
    mutationFn: (t: number) => updateFn({ data: { confidence_threshold: t } }),
    onSuccess: () => {
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["systemmind-intel-settings"] });
      qc.invalidateQueries({ queryKey: ["systemmind-template-confidence"] });
      qc.invalidateQueries({ queryKey: ["systemmind-readiness"] });
      toast.success("Confidence threshold updated.");
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <p className="text-[11px] font-semibold flex items-center gap-1.5 mb-2">
        <Sliders className="h-3.5 w-3.5 text-sky-400" /> Confidence threshold
      </p>
      <p className="text-[10px] text-muted-foreground/70 mb-2">
        Templates scoring at or above this are “recommended” for planning.
      </p>
      <div className="flex items-center gap-3">
        <input
          type="range" min={0} max={100} value={value}
          onChange={(e) => setDraft(Number(e.target.value))}
          className="flex-1 accent-sky-400"
        />
        <span className="text-sm font-semibold tabular-nums text-sky-300 w-8 text-right">{value}</span>
        <Button
          size="sm" className="h-7 text-xs"
          disabled={mut.isPending || draft === null || draft === data?.confidence_threshold}
          onClick={() => mut.mutate(value)}
        >
          {mut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
        </Button>
      </div>
    </div>
  );
}

function DashboardTab() {
  const getFn = useServerFn(getReadinessDashboardFn);
  const { data, isLoading } = useQuery({ queryKey: ["systemmind-readiness"], queryFn: () => getFn(), throwOnError: false });

  if (isLoading) return <div className="flex items-center gap-2 text-xs text-muted-foreground py-10 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Loading dashboard…</div>;
  if (!data) return <EmptyState icon={Gauge} title="No data" />;
  if (data.applied === false) return <MigrationNotice what="The readiness dashboard" />;

  const t = data.templates;
  const readyPct = t.total ? Math.round((t.recommended / t.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <ThresholdControl />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Templates" value={t.total} hint={`${t.approved} approved · ${t.ready} ready`} />
        <StatCard label="Recommended" value={t.recommended} hint={`${readyPct}% at threshold ${data.threshold}`} tone="emerald" />
        <StatCard label="Avg confidence" value={t.avg_overall} hint={`${t.scored} scored`} tone={t.avg_overall >= 70 ? "emerald" : t.avg_overall >= 45 ? "amber" : "red"} />
        <StatCard label="Stale scores" value={t.stale} hint="changed since scoring" tone={t.stale ? "amber" : "sky"} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Section icon={AlertTriangle} title="Risk distribution">
          <div className="space-y-2">
            {(["low", "medium", "high"] as const).map((r) => {
              const n = t.risk[r];
              const pct = t.scored ? Math.round((n / t.scored) * 100) : 0;
              return (
                <div key={r} className="flex items-center gap-2">
                  <RiskPill rating={r} />
                  <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div className={cn("h-full rounded-full", r === "low" ? "bg-emerald-400" : r === "medium" ? "bg-amber-400" : "bg-red-400")} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums w-6 text-right">{n}</span>
                </div>
              );
            })}
          </div>
        </Section>

        <Section icon={Cpu} title="Provider coverage">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {Object.entries(data.providers).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground capitalize">{k}</span>
                <Chip className="tabular-nums text-sky-400/80 border-sky-500/20">{v}</Chip>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Saved plans" value={data.plans.total} hint={`${data.plans.drafts} drafts`} />
        <StatCard label="Ready templates" value={t.ready} tone="emerald" />
        <StatCard label="Scored" value={t.scored} hint={`of ${t.total}`} />
        <StatCard label="Approved" value={t.approved} />
      </div>
    </div>
  );
}

function ConfidenceRow({ row }: { row: TemplateConfidenceRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02]">
      <button className="w-full flex items-center gap-3 p-2.5 text-left" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-medium truncate">{row.name}</p>
            {row.recommended && <Chip className="text-emerald-400/80 border-emerald-500/20">recommended</Chip>}
            {row.stale && <Chip className="text-amber-400/80 border-amber-500/20">stale</Chip>}
          </div>
          <p className="text-[10px] text-muted-foreground/60">{row.category ?? "General"} · {row.status ?? "draft"}</p>
        </div>
        <RiskPill rating={row.risk_rating} />
        <div className="w-24 shrink-0"><ScoreBar value={row.overall_score} /></div>
        <span className="text-sm font-semibold tabular-nums w-8 text-right text-foreground/90">{row.overall_score}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-white/[0.04] grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
          {DIMENSIONS.map((d) => {
            const score = row[d.key] as number;
            const sig = (row.signals as any)?.[d.key];
            return (
              <div key={String(d.key)}>
                <ScoreBar value={score} label={d.label} />
                {sig?.notes && (
                  <ul className="mt-1 space-y-0.5">
                    {sig.notes.slice(0, 4).map((n: string, i: number) => (
                      <li key={i} className="text-[9px] text-muted-foreground/60">· {n}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConfidenceTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listTemplateConfidenceFn);
  const scoreFn = useServerFn(scoreTemplatesFn);
  const { data, isLoading } = useQuery({ queryKey: ["systemmind-template-confidence"], queryFn: () => listFn(), throwOnError: false });

  const scoreMut = useMutation({
    mutationFn: () => scoreFn(),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["systemmind-template-confidence"] });
      qc.invalidateQueries({ queryKey: ["systemmind-readiness"] });
      qc.invalidateQueries({ queryKey: ["systemmind-improvements"] });
      toast.success(`Scored ${r.scored}/${r.total} template(s).`);
    },
    onError: (e: any) => {
      const msg = String(e?.message ?? e);
      toast.error(msg === "MIGRATION_NOT_APPLIED" ? "Run the SystemMind migration first." : msg);
    },
  });

  if (isLoading) return <div className="flex items-center gap-2 text-xs text-muted-foreground py-10 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Loading scores…</div>;
  if (data && data.applied === false) return <MigrationNotice what="Confidence scoring" />;

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          Deterministic, explainable scoring across six dimensions. Threshold: <span className="text-sky-300">{data?.threshold ?? 70}</span>.
        </p>
        <Button size="sm" className="h-8 text-xs gap-1.5" disabled={scoreMut.isPending} onClick={() => scoreMut.mutate()}>
          {scoreMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Recompute scores
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Boxes} title="No scores yet" hint="Click “Recompute scores” to score your curated templates." />
      ) : (
        <div className="space-y-1.5">{rows.map((r) => <ConfidenceRow key={r.template_id} row={r} />)}</div>
      )}
    </div>
  );
}

export function SystemMindDeploymentReadinessPage() {
  return (
    <SystemMindShell>
      <div className="p-5 max-w-6xl mx-auto">
        <div className="mb-4">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Gauge className="h-4.5 w-4.5 text-sky-400" /> Deployment Readiness
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            How deployable your template library is — an at-a-glance dashboard plus per-template confidence scores.
          </p>
        </div>

        <div className="mb-4">
          <ExecutionBanner>
            Scores and dashboards are computed from existing template knowledge. Nothing here deploys or executes.
          </ExecutionBanner>
        </div>

        <Tabs defaultValue="dashboard" className="w-full">
          <TabsList>
            <TabsTrigger value="dashboard" className="text-xs gap-1.5"><TrendingUp className="h-3.5 w-3.5" /> Dashboard</TabsTrigger>
            <TabsTrigger value="confidence" className="text-xs gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> Confidence Scores</TabsTrigger>
          </TabsList>
          <TabsContent value="dashboard" className="mt-3"><DashboardTab /></TabsContent>
          <TabsContent value="confidence" className="mt-3"><ConfidenceTab /></TabsContent>
        </Tabs>
      </div>
    </SystemMindShell>
  );
}
